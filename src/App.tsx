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
          colorLink: "#4ba1ff",
          colorBgBase: "#14151a",
          colorBgContainer: "#23262e",
          colorBgElevated: "#2a2d37",
          colorBgLayout: "#17181d",
          colorBorder: "#3a3f4b",
          colorBorderSecondary: "#2b2f39",
          colorText: "#eceef4",
          colorTextSecondary: "#a5aab6",
          borderRadius: 8,
          controlOutline: "rgba(43,143,255,0.28)",
          boxShadowSecondary: "0 12px 32px -12px rgba(0,0,0,0.6)",
        },
        components: {
          Button: {
            borderRadius: 8,
            borderRadiusSM: 6,
            fontWeight: 500,
            primaryShadow: "0 6px 16px -8px rgba(43,143,255,0.55)",
          },
          Modal: {
            borderRadiusLG: 14,
            headerBg: "transparent",
            contentBg: "#1f2127",
          },
          Popover: { borderRadiusLG: 10 },
          Tooltip: { borderRadius: 6 },
          Segmented: { itemSelectedBg: "#2b8fff", itemSelectedColor: "#fff" },
          Message: { contentBg: "#23262e" },
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
