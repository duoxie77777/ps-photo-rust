import { memo } from "react";
import { Button } from "antd";
import {
  UploadOutlined,
  PlayCircleOutlined,
  ExportOutlined,
  PlusOutlined,
} from "@ant-design/icons";

interface HeaderBarProps {
  onUploadClick: () => void;
  onProcess: () => void;
  /** 是否正在批量合成水印 */
  processing?: boolean;
  /** 是否正在导出 */
  exporting?: boolean;
  /** 是否正在导入图片 / 生成缩略图 */
  adding?: boolean;
  onExportSingle: () => void;
  canExport: boolean;
  onWatermarkCurrent: () => void;
}

function HeaderBar({
  onUploadClick,
  onProcess,
  processing,
  exporting,
  adding,
  onExportSingle,
  canExport,
  onWatermarkCurrent,
}: HeaderBarProps) {
  return (
    <header className="app-header">
      <div className="header-left">
        <div className="app-logo">
          <img src="/logo.png" alt="PS Photo" draggable={false} />
        </div>
        <div className="app-titles">
          <span className="app-name">PS Photo</span>
          <span className="app-desc">批量图片处理工作台</span>
        </div>
      </div>

      <div className="header-center">
        <Button
          type="primary"
          icon={<UploadOutlined />}
          loading={adding}
          disabled={adding}
          onClick={onUploadClick}
        >
          批量上传图片
        </Button>
        <Button icon={<PlusOutlined />} onClick={onWatermarkCurrent}>
          应用到图片
        </Button>
        <span className="header-hint">先选水印，再选择应用到全部/单张图片</span>
      </div>

      <div className="header-right">
        <Button
          icon={<ExportOutlined />}
          loading={exporting}
          disabled={!canExport || exporting}
          onClick={onExportSingle}
        >
          导出
        </Button>
        <Button
          type="primary"
          ghost
          icon={<PlayCircleOutlined />}
          onClick={onProcess}
          loading={processing}
          disabled={processing}
          className="btn-process"
        >
          开始处理
        </Button>
      </div>
    </header>
  );
}

export default memo(HeaderBar);
