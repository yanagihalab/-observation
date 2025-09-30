import React, { useState, useEffect } from "react";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const CONTRACT_ADDRESS = "neutron1pl9ex24yh67l7atm4sz7j2rzs29my0p6qnxsc9nlmyaaqy2s9azqngl6hp"; // インスタンス化されたコントラクトのアドレス
const RPC_ENDPOINT = "https://rpc-palvus.pion-1.ntrn.tech";
const CHAIN_ID = "pion-1";

function ContractTestPage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [client, setClient] = useState(null);
  const [mountain, setMountain] = useState("");
  const [startDate, setStartDate] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDenom, setDepositDenom] = useState("untrn");

  useEffect(() => {
    const initClient = async () => {
      if (!window.keplr) {
        alert("Keplrウォレットをインストールしてください。");
        return;
      }

      await window.keplr.enable(CHAIN_ID);
      const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
      const accounts = await offlineSigner.getAccounts();
      setWalletAddress(accounts[0].address);

      const cosmwasmClient = await SigningCosmWasmClient.connectWithSigner(
        RPC_ENDPOINT,
        offlineSigner
      );

      setClient(cosmwasmClient);
    };

    initClient();
  }, []);

  const submitClimbingInfo = async () => {
    if (!client) {
      alert("Clientが初期化されていません。");
      return;
    }

    const msg = {
      submit_climbing_info: {
        mountain,
        start_date: Math.floor(new Date(startDate).getTime() / 1000).toString(),
        deposit_amount: depositAmount,
        deposit_denom: depositDenom,
      },
    };

    try {
      const fee = { amount: [{ denom: "untrn", amount: "10000" }], gas: "200000" };
      const result = await client.execute(walletAddress, CONTRACT_ADDRESS, msg, fee);
      alert(`実行成功: TXハッシュ: ${result.transactionHash}`);
    } catch (error) {
      alert(`エラー発生: ${error.message}`);
    }
  };

  return (
    <div>
      <h2>登山情報登録テストページ</h2>

      <label>
        山の名前:
        <input value={mountain} onChange={(e) => setMountain(e.target.value)} />
      </label>

      <label>
        入山日:
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>

      <label>
        デポジット量:
        <input
          type="number"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
      </label>

      <button onClick={submitClimbingInfo}>登山情報を送信する</button>
    </div>
  );
}

export default ContractTestPage;
