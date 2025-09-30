// src/PageList.jsx
import React from 'react';
import { Link } from 'react-router-dom';

function PageList() {
  return (
    <div className="p-4">
      <h1 className="text-2xl mb-4">📄 ページ一覧</h1>
      <ul className="list-disc list-inside">
        <li><Link className="text-blue-500 hover:underline" to="/qr-reader">QRコード読み取りページ</Link></li>
        <li><Link className="text-blue-500 hover:underline" to="/submit-form">登山届フォームページ</Link></li>
        <li><Link to="/descent-form">下山届フォーム</Link></li> 
        <li><Link className="text-blue-500 hover:underline" to="/qr-display">QRコード表示ページ</Link></li>
        <><br /></>
        <li><Link to="/ipfs-upload">IPFS画像アップロード</Link></li>
        <li><Link to="/mint-nft">参加入場NFTの発行</Link></li>
        <li><Link to="/ipfs-upload-mint">観察記録</Link></li>
        <li><Link to="/contract-test">コントラクトテストページ1</Link></li>
        <li><Link to="/all-contract-messages">コントラクトテストページ2</Link></li>
        <li><Link to="/ClimbingInfoViewer">トランザクション確認</Link></li>
        <li><Link to="/TestWalletGenerator">テストウォレットの作成</Link></li>
        <li><Link to="/faucet">Fucet Page (蛇口をひねる)</Link></li>
      </ul>
    </div>
  );
}

export default PageList;
