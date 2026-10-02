import { ToolPage } from '@/components/tool-page';
import { StakingConsole } from '@/components/staking-console';

export default function Page() {
  return (
    <ToolPage kind="stake">
      <StakingConsole />
    </ToolPage>
  );
}
