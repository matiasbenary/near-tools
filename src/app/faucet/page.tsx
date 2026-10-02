import { ToolPage } from '@/components/tool-page';
import { FaucetTool } from '@/components/faucet-tool';

export default function Page() {
  return (
    <ToolPage kind="faucet">
      <FaucetTool />
    </ToolPage>
  );
}
