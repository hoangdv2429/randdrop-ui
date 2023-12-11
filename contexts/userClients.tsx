import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { ChainType } from "../pages/api/check";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { LedgerSigner } from "@cosmjs/ledger-amino";
import { GasPrice } from "@cosmjs/stargate";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
import { getChainConfig } from "../services/chainConfig";
import { getKeplr, getLeap } from "../services/keplr";
import { toast } from "react-hot-toast";
import { makeCosmosPath } from "../services/ledgerHelpers";
import EthereumApp from "@ledgerhq/hw-app-eth";
import { createSigners, SIGN_DIRECT, ChainRestAuthApi, BaseAccount } from "@injectivelabs/sdk-ts";

const chains: ChainType[] = ["uni", "juno", "injective", "stargaze", "aura"];
export type WalletType = "keplr" | "leap" | "ledger";
export interface ChainSigningClient {
  walletType: WalletType;
  chain: ChainType;
  walletAddress: string;
  // Everything except Injective via LedgerUSB
  signingClient?: SigningCosmWasmClient;
  // Injective LedgerUSB
  ethLedgerClient?: EthLedgerAccount;
}

export interface EthLedgerAccount {
  ethApp: EthereumApp;
  pubKey: string;
}

export interface UserSigningClientsContext {
  walletType: string;
  changeWalletType: (newWallet: string) => void;
  uniClient?: ChainSigningClient;
  junoClient?: ChainSigningClient;
  injectiveClient?: ChainSigningClient;
  stargazeClient?: ChainSigningClient;
  auraClient?: ChainSigningClient;
  loading: boolean;
  nickname: string;
  connectAll: any;
  disconnectAll: Function;
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// SigningClients context
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
let MultiClientsContext: any;
let { Provider: ClientsProvider } = (MultiClientsContext =
  createContext<UserSigningClientsContext>({
    walletType: "",
    changeWalletType: (newWallet: string) => {},
    uniClient: undefined,
    junoClient: undefined,
    injectiveClient: undefined,
    stargazeClient: undefined,
    auraClient: undefined,
    loading: false,
    nickname: "",
    connectAll: () => {},
    disconnectAll: () => {},
  }));

export const useMultiClientsContext = (): UserSigningClientsContext =>
  useContext(MultiClientsContext);

export const MultiClientProvider = ({ children }: { children: ReactNode }) => {
  const [currentWalletType, setWalletType] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [nickname, setNickname] = useState("");
  const [userSigningClients, setUserSigningClients] = useState<
    ChainSigningClient[] | undefined
  >();

  const connectAll = useCallback(async () => {
    setLoading(true);
    // Remove any previous clients
    setUserSigningClients(undefined);
    switch (currentWalletType) {
      case "ledger": {
        for (const chain of chains) {
          try {
            // Get Ledger offline signer & client
            let ledgerOffline = await getLedgerUsbClient(chain);
            // update clients & nickname (nickname for ledger is just LedgerUSB)
            setNickname(ledgerOffline.nickname);
            setUserSigningClients((old) =>
              old ? [...old, ledgerOffline.client] : [ledgerOffline.client]
            );
          } catch (e) {
            console.log(e);
            toast.error(
              `Problem establishing LedgerUSB connection to ${chain}`
            );
          }
        }
        break;
      }
      case "keplr": {
        for (const chain of chains) {
          try {
            // Suggest/connect/return client & nickname
            let client = await getKeplrClient(chain);
            // update userSigningClients &nickname
            setNickname(client.nickname);
            setUserSigningClients((old) =>
              old ? [...old, client.client] : [client.client]
            );
          } catch (e) {
            console.log(e);
            toast.error(`Problem connecting Keplr to ${chain}`);
          }
        }
        break;
      }
      case "leap": {
        for (const chain of chains) {
          try {
            // Suggest/connect/return client& nickname
            let client = await getLeapClient(chain);
            // update clients & nickname
            setNickname(client.nickname);
            setUserSigningClients((old) =>
              old ? [...old, client.client] : [client.client]
            );
          } catch (e) {
            console.log(e);
            toast.error(`Problem connecting Leap to ${chain}`);
          }
        }
        break;
      }
      default: {
        break;
      }
    }

    setLoading(false);
  }, [currentWalletType]);

  const disconnectAll = useCallback(() => {
    setLoading(true);
    if (userSigningClients) {
      for (const client of userSigningClients) {
        client.signingClient && client.signingClient.disconnect();
      }
    }
    setUserSigningClients(undefined);
    setNickname("");
    setLoading(false);
  }, [currentWalletType]);

  const userClients: UserSigningClientsContext = {
    walletType: currentWalletType,
    changeWalletType: setWalletType,
    uniClient: userSigningClients?.find((c) => c.chain === "uni"),
    junoClient: userSigningClients?.find((c) => c.chain === "juno"),
    injectiveClient: userSigningClients?.find((c) => c.chain === "injective"),
    stargazeClient: userSigningClients?.find((c) => c.chain === "stargaze"),
    auraClient: userSigningClients?.find((c) => c.chain === "aura"),
    loading,
    nickname,
    connectAll,
    disconnectAll,
  };

  return <ClientsProvider value={userClients}>{children}</ClientsProvider>;
};

export const useAllMultiClients = () => {
  const {
    walletType,
    changeWalletType,
    uniClient,
    junoClient,
    injectiveClient,
    stargazeClient,
    auraClient,
    loading,
    nickname,
    connectAll,
    disconnectAll,
  } = useMultiClientsContext();

  const handleConnectAll = () => {
    if (
      [uniClient, junoClient, injectiveClient, stargazeClient, auraClient].some(
        (v) => v != undefined
      )
    ) {
      disconnectAll();
    } else {
      connectAll();
    }
  };

  return {
    walletType,
    changeWalletType,
    uniClient,
    junoClient,
    injectiveClient,
    stargazeClient,
    auraClient,
    loading,
    nickname,
    handleConnectAll,
    disconnectAll,
  };
};

const getKeplrClient = async (chain: ChainType) => {
  const keplr = await getKeplr();
  let chainInfo = getChainConfig(chain);
  await keplr.experimentalSuggestChain(chainInfo);
  await keplr.enable(chainInfo.chainId);
  const offlineSigner = keplr.getOfflineSignerOnlyAmino(chainInfo.chainId);
  let client;
  let signerDetails;
  // modify so that we can use createTransactionWithSigners, instead of return signingClient, return signerDetails instead
  if (chain === "injective") {
    /** Account Details **/
    const chainRestAuthApi = new ChainRestAuthApi(chainInfo.rest)
    const accountDetailsResponse = await chainRestAuthApi.fetchAccount(
      offlineSigner.getAccounts()[0].address,
    )
    const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse)
    const accountDetails = baseAccount.toAccountDetails()
    const key = await keplr.getKey(chainInfo.chainId)
    const pubKey = Buffer.from(key.pubKey).toString('base64')
    // create another type of client for injective
    // client = await createSigners({ 
    //   chainId: chainInfo.chainId, 
    //   mode: SIGN_DIRECT, 
    //   signers: {
    //   pubKey: pubKey,
    //   accountNumber: ,
    //   sequence: ,
    // }, });
  } else {
    client = await SigningCosmWasmClient.connectWithSigner(
      chainInfo.rpc,
      offlineSigner,
      {
        gasPrice: GasPrice.fromString(
          `${chainInfo.feeCurrencies[0].gasPriceStep?.average}${chainInfo.currencies[0].coinMinimalDenom}`
        ),
      }
    );
  }
  const [{ address }] = await offlineSigner.getAccounts();
  const nickname = await keplr.getKey(chainInfo.chainId);
  const chainClient = {
    chain: chain,
    walletAddress: address,
    signingClient: client,
    walletType: "keplr",
  } as ChainSigningClient;

  return {
    client: chainClient,
    nickname: nickname.name,
  };
};

const getLeapClient = async (chain: ChainType) => {
  const leap = await getLeap();
  let chainInfo = getChainConfig(chain);
  await leap.experimentalSuggestChain(chainInfo);
  await leap.enable(chainInfo.chainId);
  const offlineSigner = leap.getOfflineSignerOnlyAmino(chainInfo.chainId);
  const client = await SigningCosmWasmClient.connectWithSigner(
    chainInfo.rpc,
    offlineSigner,
    {
      gasPrice: GasPrice.fromString(
        `${chainInfo.feeCurrencies[0].gasPriceStep?.average}${chainInfo.currencies[0].coinMinimalDenom}`
      ),
    }
  );
  const [{ address }] = await offlineSigner.getAccounts();
  const nickname = await leap.getKey(chainInfo.chainId);
  const chainClient = {
    chain: chain,
    walletAddress: address,
    signingClient: client,
    walletType: "leap",
  } as ChainSigningClient;

  return {
    client: chainClient,
    nickname: nickname.name,
  };
};

const getLedgerUsbClient = async (chain: ChainType) => {
  // Get chainInfo
  let chainInfo = getChainConfig(chain);

  // Setting up Ledger Transport
  const ledgerTransport = await TransportWebUSB.create(120_000, 120_000);

  // Setting up Ledger Connection
  if (chain === "injective") {
    // Injective uses the Ethereum App on Ledger Live so setup is different
    const ledger = new EthereumApp(ledgerTransport);

    // Assumes account & address_index of 0
    const { publicKey, address } = await ledger.getAddress("44'/60'/0'/0/0");
    const ethLedgerAccount: EthLedgerAccount = {
      ethApp: ledger,
      pubKey: publicKey,
    };

    const chainClient = {
      chain: chain,
      walletAddress: address,
      ethLedgerClient: ethLedgerAccount,
      walletType: "ledger",
    } as ChainSigningClient;

    return {
      client: chainClient,
      nickname: "LedgerUSB",
    };
  } else {
    const hdPaths = [makeCosmosPath(0)];

    const offlineSigner = new LedgerSigner(ledgerTransport, {
      hdPaths: hdPaths,
      prefix: chainInfo.bech32Config.bech32PrefixAccAddr,
    });

    // create cosmwasmSigningClient
    const client = await SigningCosmWasmClient.connectWithSigner(
      chainInfo.rpc,
      offlineSigner,
      {
        gasPrice: GasPrice.fromString(
          `${chainInfo.feeCurrencies[0].gasPriceStep?.average}${chainInfo.currencies[0].coinMinimalDenom}`
        ),
      }
    );
    const addressAndKey = await offlineSigner.showAddress();

    const chainClient = {
      chain: chain,
      walletAddress: addressAndKey.address,
      signingClient: client,
      walletType: "ledger",
    } as ChainSigningClient;

    return {
      client: chainClient,
      nickname: "LedgerUSB",
    };
  }
};
