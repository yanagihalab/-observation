import { useState } from "react";
import { useNavigate } from 'react-router-dom';

function IPFSUploadForm() {
  const navigate = useNavigate();
  const [image, setImage] = useState(null);

  function fileReadAsDataURL(data) {
    return new Promise((result, reject) => {
      let reader = new FileReader();
      reader.addEventListener("load", ({ target }) => result(target.result));
      reader.addEventListener("error", ({ target }) => reject(target.error));
      reader.readAsDataURL(data);
    });
  }
  const handleFileChange = async (event) => {
    let images = event.target.files;
    if (!images || images.length == 0) return;
    let data = await fileReadAsDataURL(images[0]);
    setImage(data);
  };

  const handleUpload = async () => {
    if (!image) {
      alert("ファイルを選択してください。");
      return;
    }

    let data = image.substring(image.indexOf(",") + 1);
    fetch('https://fukaya-lab.azurewebsites.net/api/yama/upload', { method: 'POST', body: JSON.stringify({ Image: data, }) })
      .then(() => navigate('/ipfs-list'))
      .catch((error) => console.log(error));
  };

  return (
    <div className="div_base">
      <div className="div_header">IPFS画像アップロードフォーム</div>
      <div className="div_content" style={{ padding: "10px" }}>
        <div style={{ display: "flex" }}>
          <label className="div_button" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="material-icons">image</i>
            <span style={{ width: "10px", flexShrink: "0" }}></span>
            <span style={{ whiteSpace: "pre" }}>写真の選択</span>
            <input style={{ opacity: "0", margin: "0px", padding: "0px", width: "0px" }} type="file" onChange={handleFileChange} />
          </label>
        </div>
        <div style={{ whiteSpace: "initial", position: "relative", marginTop: "10px" }}>
          {image && <img style={{ width: "100%", maxWidth: "320px" }} src={image} />}
        </div>
        {!image && <div style={{ marginTop: "10px" }}>ファイルを選択してください。</div>}
        {image && <button type="button" onClick={handleUpload} style={{ marginTop: "10px" }}>IPFSにアップロード </button>}
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

export default IPFSUploadForm;
