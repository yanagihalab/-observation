import React, { useState, useEffect } from "react";
import { SigningCosmWasmClient, CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const CONTRACT_ADDRESS = "neutron172mv76k3y6ffdfs0x3v6mezu3ecg0wvc8gq5zm5m57tz3etvwwdq3cpfyr";
const RPC_ENDPOINT = "https://rpc-palvus.pion-1.ntrn.tech";
const CHAIN_ID = "pion-1";

function DescentForm() {
  const [walletInfo, setWalletInfo] = useState("");
  const [mountain, setMountain] = useState("");
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    const getWalletInfo = async () => {
      if (!window.keplr) {
        alert("Keplrウォレットが見つかりません。");
        return;
      }

      try {
        await window.keplr.enable(CHAIN_ID);
        const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
        const accounts = await offlineSigner.getAccounts();

        if (accounts && accounts.length > 0) {
          const address = accounts[0].address;
          setWalletInfo(address);
          fetchClimbingInfo(address);
        } else {
          alert("ウォレットアドレスを取得できませんでした。");
        }
      } catch (error) {
        alert("Keplrウォレットとの接続に失敗しました：" + error.message);
      }
    };

    const fetchClimbingInfo = async (address) => {
      try {
        const client = await CosmWasmClient.connect(RPC_ENDPOINT);
        const result = await client.queryContractSmart(CONTRACT_ADDRESS, {
          get_climbing_info: { climber: address },
        });

        if (result && result.is_climbing) {
          setMountain(result.mountain);
          setStartDate(new Date(result.start_date * 1000).toISOString().slice(0, 10)); // 秒をミリ秒に戻す
        } else {
          alert("有効な入山情報がありません。");
        }
      } catch (error) {
        alert("入山情報の取得に失敗しました: " + error.message);
      }
    };


    getWalletInfo();
  }, []);

  const handleDescentSubmit = async () => {
    if (!walletInfo || !mountain || !startDate) {
      alert("必要な情報が不足しています。");
      return;
    }

    if (!window.keplr) {
      alert("Keplrウォレットが見つかりません。");
      return;
    }

    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const client = await SigningCosmWasmClient.connectWithSigner(RPC_ENDPOINT, offlineSigner);

    const msg = {
      submit_descent_info: {
        mountain,
        start_date: (new Date(startDate).getTime() / 1000).toString(), // 修正箇所
      },
    };

    try {
      const fee = { amount: [{ denom: "untrn", amount: "10000" }], gas: "200000" };
      const result = await client.execute(walletInfo, CONTRACT_ADDRESS, msg, fee);
      alert("下山届を送信しました。TXハッシュ：" + result.transactionHash);
    } catch (error) {
      alert("エラーが発生しました：" + error.message);
    }
  };

  return (
    <div>
      <h2>下山届フォーム</h2>

      <label>
        ウォレット情報:
        <input type="text" value={walletInfo} readOnly />
      </label>

      <label>
        登山場所:
        <input type="text" value={mountain} readOnly />
      </label>

      <label>
        入山日:
        <input type="date" value={startDate} readOnly />
      </label>

      <button type="button" onClick={handleDescentSubmit}>
        下山届を提出
      </button>
    </div>
  );
}

export default DescentForm;
