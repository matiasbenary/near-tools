import { ToolPage } from '@/components/tool-page';
import { HoldingsPanel } from '@/components/holdings-panel';
import { NftAction } from '@/components/actions/nft-action';

export default function Page() {
  return (
    <ToolPage kind="nft">
      <HoldingsPanel kind="nft" />
      <NftAction />
    </ToolPage>
  );
}
