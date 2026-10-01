import { ToolPage } from '@/components/tool-page';
import { FunctionCallKeys } from '@/components/function-call-keys';
import { StorageCleanup } from '@/components/storage-cleanup';

export default function Page() {
  return (
    <ToolPage kind="keys">
      <StorageCleanup />
      <FunctionCallKeys />
    </ToolPage>
  );
}
