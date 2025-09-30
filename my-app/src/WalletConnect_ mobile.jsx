import React, { useState } from 'react';
import WalletConnect from "@walletconnect/client";
import QRCodeModal from "@walletconnect/qrcode-modal";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const CHAIN_ID = "pion-1";
const RPC_ENDPOINT = "https://rpc-palvus.pion-1.ntrn.tech";

function WalletConnectExample() {
  const [walletAddress, setWalletAddress] = useState("");

  const connectWallet = async () => {
    const connector = new WalletConnect({ bridge: "https://bridge.walletconnect.org" });

    if (!connector.connected) {
      await connector.createSession();
      QRCodeModal.open(connector.uri, () => console.log("QR Modal closed"));
    }

    connector.on("connect", async (error, payload) => {
      if (error) {
        throw error;
      }

      QRCodeModal.close();

      const { accounts } = payload.params[0];
      const address = accounts[0];
      setWalletAddress(address);

      const offlineSigner = {
        getAccounts: async () => [{ address }],
        signDirect: async () => { throw new Error("Not implemented"); },
        signAmino: async () => { throw new Error("Not implemented"); },
      };

      const cosmwasmClient = await SigningCosmWasmClient.connectWithSigner(RPC_ENDPOINT, offlineSigner);

      console.log("Connected:", address, cosmwasmClient);
    });
  };

  return (
    <div>
      <button onClick={connectWallet}>
        ウォレット接続（WalletConnect）
      </button>
      <div>ウォレットアドレス: {walletAddress}</div>
    </div>
  );
}

export default WalletConnectExample;
