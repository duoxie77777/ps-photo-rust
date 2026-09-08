import { App as AntApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import EditorLayout from "./components/EditorLayout";
import LicenseGate from "./components/LicenseGate";
import "./App.css";

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#2b8fff",
          colorBgContainer: "#232327",
          colorBgElevated: "#2b2b30",
          colorBorder: "#3a3a42",
          colorBorderSecondary: "#33333a",
          colorText: "#e6e6e9",
          colorTextSecondary: "#9a9aa3",
          borderRadius: 6,
        },
      }}
    >
      <AntApp>
        <LicenseGate>
          <EditorLayout />
        </LicenseGate>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
