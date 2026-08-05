import { Navigate } from "react-router-dom";

/** Legacy procurement URL — BOM upload moved to Department portal. */
export default function UploadBomPage() {
  return <Navigate to="/department/upload-bom" replace />;
}
