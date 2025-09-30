// App.jsx
import React from "react";
import { Routes, Route } from "react-router-dom";

import QrReaderPage from "./QrReaderPage";
import SubmitForm from "./SubmitForm";
import QrCodeDisplay from "./QrCodeDisplay";
import PageList from "./PageList";
import DescentForm from "./DescentForm";
import IPFSUploadForm from "./IPFSUploadForm";
import IPFSListPage from "./IPFSListPage";
import SummitQRCode from "./SummitQRCode";
import SummitForm from "./SummitForm";
import ContractTestPage from "./ContractTestPage.jsx";
import AllContractMessagesPage from "./AllContractMessagesPage";
import ClimbingInfoViewer from "./ClimbingInfoViewer";
import WalletGenerator from "./WalletGenerator";

// 既存の簡易ミント画面（必要なら残す）
import MintNFTPage from "./MintNFTPage";

// ★ 追加：コントラクト拡張版に対応した新ミント画面（Pinata削除・custom専用）
import IPFSUploadAndMintPage from "./IPFSUploadAndMintPage";

// ★ 追加：Faucet ページ（import は既にありました）
import FaucetPage from "./FaucetPage";

function App() {
  return (
    <Routes>
      {/* 既存 */}
      <Route path="/" element={<PageList />} />
      <Route path="/qr-reader" element={<QrReaderPage />} />
      <Route path="/submit-form" element={<SubmitForm />} />
      <Route path="/qr-display" element={<QrCodeDisplay />} />
      <Route path="/descent-form" element={<DescentForm />} />
      <Route path="/ipfs-upload" element={<IPFSUploadForm />} />
      <Route path="/ipfs-list" element={<IPFSListPage />} />
      <Route
        path="/summit-qr"
        element={<SummitQRCode walletAddress="ユーザーのアドレス" mountain="蓼科山" />}
      />
      <Route path="/summit-form" element={<SummitForm />} />
      <Route path="/contract-test" element={<ContractTestPage />} />
      <Route path="/all-contract-messages" element={<AllContractMessagesPage />} />
      <Route path="/ClimbingInfoViewer" element={<ClimbingInfoViewer />} />
      <Route path="/TestWalletGenerator" element={<WalletGenerator />} />
      {/* ★ 追加：拡張版ミント（Reveal / 期間 / 供給上限 / 転送ロック / 料金に対応） */}
      <Route path="/ipfs-upload-mint" element={<IPFSUploadAndMintPage />} />
      {/* （任意）従来の簡易ミント画面も残す場合 */}
      <Route path="/mint-nft" element={<MintNFTPage />} />
      <Route path="/faucet" element={<FaucetPage />} />
    </Routes>
  );
}

export default App;
