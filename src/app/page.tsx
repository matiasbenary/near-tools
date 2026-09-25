import { ToolPage } from '@/components/tool-page';
import { StakingConsole } from '@/components/staking-console';

export default function Home() {
  return (
    <ToolPage kind="stake">
      <StakingConsole />
    </ToolPage>
  );
}
