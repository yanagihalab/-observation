import { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';

function QrReaderPage() {
  const navigate = useNavigate();
  const [width, setWidth] = useState(500);
  const [height, setHeight] = useState(500);

  useEffect(() => {
    let h = document.documentElement.clientHeight - 124;
    let w = Math.min(document.documentElement.clientWidth - 2, h - 120);
    setWidth(w);
    setHeight(h);
    let b = w * 0.6;
    const scanner = new Html5QrcodeScanner('qr-camera-reader', { fps: 10, qrbox: { width: b, height: b }, aspectRatio: 1.0, });
    scanner.render(
      (decodedText) => {
        scanner.clear();
        handleQrScanSuccess(decodedText);
      },
      (error) => {
        console.warn('Camera scan error:', error);
      }
    );

    return () => scanner.clear();
  }, []);

  const handleQrScanSuccess = (decodedText) => {
    const qrInfo = JSON.parse(decodedText);
    navigate('/submit-form', { state: { qrInfo } });
  };

  return (
    <div className="div_base">
      <div className="div_header">QRコード読み取りページ</div>
      <div className="div_content" style={{ overflow: "hidden" }}>
        <div id="qr-camera-reader" style={{ width: width, height: height, margin: "0px auto" }}></div>
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

export default QrReaderPage;

