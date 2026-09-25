import { ToolPage } from '@/components/tool-page';
import { HoldingsPanel } from '@/components/holdings-panel';
import { LinkdropAction } from '@/components/actions/linkdrop-action';

export default function Page() {
  return (
    <ToolPage kind="linkdrop">
      <HoldingsPanel kind="linkdrop" />
      <LinkdropAction />
    </ToolPage>
  );
}
