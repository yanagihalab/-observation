import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { useNavigate } from 'react-router-dom';

const CONTRACT_ADDRESS = "neutron172mv76k3y6ffdfs0x3v6mezu3ecg0wvc8gq5zm5m57tz3etvwwdq3cpfyr";
const RPC_ENDPOINT = "https://rpc-palvus.pion-1.ntrn.tech";
const CHAIN_ID = "pion-1";

function SubmitForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const qrInfo = location.state?.qrInfo;

  const [walletInfo, setWalletInfo] = useState("");
  const [manualWalletInfo, setManualWalletInfo] = useState("");
  const [climbDate, setClimbDate] = useState("");
  const [mountain, setMountain] = useState("");
  const [depositValue, setDepositValue] = useState("");
  const [depositDenom, setDepositDenom] = useState("untrn");
  const [returnDate, setReturnDate] = useState("");
  const [latitide, setLatitide] = useState(0);
  const [longitude, setLongitude] = useState(0);

  // ページ表示時刻を保持
  const pageLoadTimeRef = useRef(null);

  useEffect(() => {
    pageLoadTimeRef.current = performance.now(); // ページ表示時刻を記録
  }, []);

  useEffect(() => {
    const getWalletInfo = async () => {
      if (!window.keplr) {
        alert("Keplrウォレットが見つかりません。Keplrをインストールしてください。");
        return;
      }

      await window.keplr.enable(CHAIN_ID);
      const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
      const accounts = await offlineSigner.getAccounts();

      if (accounts && accounts.length > 0) {
        setWalletInfo(accounts[0].address);
      } else {
        alert("ウォレットアドレスを取得できませんでした。");
      }
    };

    if (navigator.userAgent.indexOf("iPhone") > 0 || navigator.userAgent.indexOf("iPad") > 0 || navigator.userAgent.indexOf("iPod") > 0) {
      // iPhone
    } else if (navigator.userAgent.indexOf("Android") > 0) {
      // Android
    } else {
      getWalletInfo();
    }
  }, []);

  useEffect(() => {
    if (qrInfo) {
      setClimbDate(qrInfo.startDate.slice(0, 10));
      setMountain(qrInfo.mountainLocation);
      setDepositValue(qrInfo.depositAmount);
      setDepositDenom(qrInfo.depositDenom);
    }
  }, [qrInfo]);

  const handleClimbSubmit = async () => {
    const address = manualWalletInfo || walletInfo;

    if (!address || !mountain || !climbDate || !depositValue || !returnDate) {
      alert("すべての情報を入力してください。");
      return;
    }

    if (!window.keplr) {
      alert("Keplrウォレットが見つかりません。");
      return;
    }

    await window.keplr.enable(CHAIN_ID);
    const offlineSigner = window.keplr.getOfflineSigner(CHAIN_ID);
    const client = await SigningCosmWasmClient.connectWithSigner(RPC_ENDPOINT, offlineSigner);

    const startTimestamp = Math.floor(new Date(climbDate).getTime() / 1000).toString();
    const scheduledReturnTimestamp = Math.floor(new Date(returnDate).getTime() / 1000).toString();

    const msg = {
      submit_climbing_info: {
        mountain,
        start_date: startTimestamp,
        scheduled_return_date: scheduledReturnTimestamp,
        deposit_amount: depositValue.toString(),
        deposit_denom: depositDenom,
      },
    };

    try {
      const txStartTime = performance.now(); // TX送信開始時刻
      const fee = { amount: [{ denom: depositDenom, amount: "10000" }], gas: "200000" };
      const result = await client.execute(address, CONTRACT_ADDRESS, msg, fee);
      const txEndTime = performance.now(); // TX成功時刻

      const totalTimeSec = ((txEndTime - pageLoadTimeRef.current) / 1000).toFixed(2);
      const txExecutionTimeSec = ((txEndTime - txStartTime) / 1000).toFixed(2);

      alert(
        `入山届を送信しました。\nTXハッシュ：${result.transactionHash}\n` +
        `ページ表示からTX成功まで：${totalTimeSec}秒\n` +
        `TX送信から成功まで：${txExecutionTimeSec}秒`
      );
    } catch (error) {
      alert("エラーが発生しました：" + error.message);
    }
  };

  const getCurrentPosition = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(position => {
        setLatitide(position.coords.latitude);
        setLongitude(position.coords.longitude);
      }, () => {
        alert("位置情報を取得できません");
      });
    } else {
      alert("位置情報を取得できません");
    }
  }


  return (
    <div className="div_base">
      <div className="div_header">入山届フォーム</div>
      <div className="div_content" style={{ padding: "10px" }}>
        <label>
          ウォレット情報 (自動取得):
          <input type="text" value={walletInfo} readOnly />
        </label>
        <label>
          ウォレット情報 (手動入力・オプション):
          <input
            type="text"
            value={manualWalletInfo}
            onChange={(e) => setManualWalletInfo(e.target.value)}
            placeholder="手動でウォレットアドレスを入力"
          />
        </label>
        <label>
          入山日:
          <input type="date" value={climbDate} onChange={(e) => setClimbDate(e.target.value)} />
        </label>
        <label>
          下山日（予定）:
          <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
        </label>
        <label>
          登山場所:
          <input type="text" value={mountain} onChange={(e) => setMountain(e.target.value)} />
        </label>
        <label>
          デポジット額: <span>{depositDenom}</span>
          <input
            type="number"
            value={depositValue}
            onChange={(e) => setDepositValue(e.target.value)}
          />
        </label>
        <div style={{ marginTop: "10px" }}><button type="button" onClick={getCurrentPosition}>位置情報を取得</button>({latitide}, {longitude})</div>
        <button type="button" onClick={handleClimbSubmit} style={{ marginTop: "10px" }}>入山届を提出</button>
      </div>
      <div style={{ height: "2px", backgroundColor: "#ABCE1C" }}></div>
      <div style={{ height: "60px", display: "flex" }}>
        <div className="div_footer" role="button" onClick={() => navigate('/qr-reader')}><i class="material-icons">qr_code_scanner</i></div>
        <div style={{ width: "2px", backgroundColor: "#ABCE1C", margin: "10px 0px" }}></div>
        <div className="div_footer" role="button" onClick={() => navigate('/ipfs-upload')}><i class="material-icons">upload_file</i></div>
        <div style={{ width: "2px", backgroundColor: "#ABCE1C", margin: "10px 0px" }}></div>
        <div className="div_footer" role="button" onClick={() => navigate('/ipfs-list')}><i class="material-icons">collections</i></div>
      </div>
    </div>
  );
}

export default SubmitForm;
