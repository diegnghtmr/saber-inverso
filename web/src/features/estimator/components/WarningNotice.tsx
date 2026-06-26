import type { FunctionComponent } from 'preact';

interface WarningNoticeProps {
  warnings: string[];
}

const WarningNotice: FunctionComponent<WarningNoticeProps> = ({ warnings }) => {
  if (!warnings.length) return null;
  return (
    <div class="warning-notice" role="alert">
      <strong>Advertencias</strong>
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
};

export default WarningNotice;
