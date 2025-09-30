import React, { useEffect, useState } from 'react';

const CONTRACT_ADDRESS = "neutron172mv76k3y6ffdfs0x3v6mezu3ecg0wvc8gq5zm5m57tz3etvwwdq3cpfyr";
const REST_ENDPOINT = "https://rest-palvus.pion-1.ntrn.tech";

function ClimbingInfoViewer() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const decodeBase64Utf8 = (base64) => {
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoder = new TextDecoder('utf-8');
      const decodedString = decoder.decode(bytes);
      return JSON.parse(decodedString);
    } catch (e) {
      console.error(e);
      return { raw: atob(base64) };
    }
  };

  const fetchData = async () => {
    try {
      const response = await fetch(`${REST_ENDPOINT}/cosmwasm/wasm/v1/contract/${CONTRACT_ADDRESS}/state`);
      const data = await response.json();

      if (data && data.models) {
        const decodedData = data.models.map((item) => ({
          key: item.key,
          value: decodeBase64Utf8(item.value),
        }));

        setInfo(decodedData);
      } else {
        setError("データが見つかりませんでした");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <div>Error: {error}</div>;
  if (!info) return <div>読み込み中...</div>;

  return (
    <div style={{ padding: "20px" }}>
      <h2>📑 入山情報 (Contract State)</h2>
      {info.map((item, index) => (
        <div key={index} style={{ marginBottom: "20px" }}>
          <h3>🔑 Key: {item.key}</h3>
          <pre style={{ background: "#f6f8fa", padding: "10px", borderRadius: "8px", overflowX: "auto" }}>
            {JSON.stringify(item.value, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default ClimbingInfoViewer;
