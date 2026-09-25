import { ToolPage } from '@/components/tool-page';
import { HoldingsPanel } from '@/components/holdings-panel';
import { FtAction } from '@/components/actions/ft-action';

export default function Page() {
  return (
    <ToolPage kind="ft">
      <HoldingsPanel kind="ft" />
      <FtAction />
    </ToolPage>
  );
}
