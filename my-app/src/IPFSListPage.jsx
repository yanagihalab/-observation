import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function IPFSListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [clientWidth, setClientWidth] = useState(100);
  const [itemWidth, setItemWidth] = useState(100);
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    listing();
  }, []);

  const listing = () => {
    fetch('https://fukaya-lab.azurewebsites.net/api/yama/list', { method: 'GET' })
      .then(response => response.json())
      .then(data => {
        var client = document.documentElement.clientWidth - 16;
        var columns = Math.max(2, Math.ceil(client / 400));
        setClientWidth(client);
        setItemWidth(client / columns - 16);
        setItems(data);
        data.forEach(item => {
          let entity = JSON.parse(item.data);
          item.like = entity ? (entity.Likes ? entity.Likes : 0) : 0;
        });
      });
  }

  const like = async (id) => {
    fetch('https://fukaya-lab.azurewebsites.net/api/yama/like', { method: 'POST', body: JSON.stringify({ Id: id, Data: '{}', }) })
      .then(() => {
        listing();
        setDialog(null);
      })
      .catch((error) => console.log(error));
  };

  return (
    <div className="div_base">
      <div className="div_header">IPFS画像リストページ</div>
      <div className="div_content">
        <div style={{ display: "flex", flexWrap: "wrap", width: clientWidth, margin: "8px" }}>
          {items.map(item => (
            <div key={item.id} style={{ position: "relative", margin: "8px", width: itemWidth, height: itemWidth, cursor: "pointer", userSelect: "none" }} role="button" onClick={() => setDialog(item)}>
              <img style={{ objectFit: "cover", width: itemWidth, height: itemWidth }} src={('https://dipardx.z11.web.core.windows.net/thumbnail/' + item.blob)} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: "2px", backgroundColor: "#ABCE1C" }}></div>
      <div style={{ height: "60px", display: "flex" }}>
        <div className="div_footer" role="button" onClick={() => navigate('/qr-reader')}><i class="material-icons">qr_code_scanner</i></div>
        <div style={{ width: "2px", backgroundColor: "#ABCE1C", margin: "10px 0px" }}></div>
        <div className="div_footer" role="button" onClick={() => navigate('/ipfs-upload')}><i class="material-icons">upload_file</i></div>
        <div style={{ width: "2px", backgroundColor: "#ABCE1C", margin: "10px 0px" }}></div>
        <div className="div_footer" role="button" onClick={() => navigate('/ipfs-list')}><i class="material-icons">collections</i></div>
      </div>

      {dialog &&
        <div className="div_overlay">
          <div className="div_container">
            <div className="div_header">画像の詳細</div>
            <div style={{ flex: "1", padding: "10px" }}>
              <div><a target='_blank' href={('https://dipardx.z11.web.core.windows.net/original/' + dialog.blob)}>元画像にアクセス</a></div>
              <div><a target='_blank' href={('https://ipfs.yamada.jo.sus.ac.jp/ipfs/' + dialog.ipfs)}>IPFSのファイルにアクセス</a></div>
              <div>いいね：{ dialog.like }</div>
              <div style={{ paddingTop: "10px" }}>
                <button type="button" style={{ width: "100%", maxWidth: "none" }} onClick={() => like(dialog.id)}>いいね</button>
              </div>
            </div>
            <div style={{ padding: "10px" }}>
              <button type="button" style={{ width: "100%", maxWidth: "none" }} onClick={() => setDialog(null)}>閉じる</button>
            </div>
          </div>
        </div>
      }
    </div>
  );
}

export default IPFSListPage;

