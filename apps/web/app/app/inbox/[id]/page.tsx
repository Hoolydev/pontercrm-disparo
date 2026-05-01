import ConversationListPane from "../../../../components/chat/ConversationListPane";
import ChatPane from "../../../../components/chat/ChatPane";

export default async function ConversationPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex h-full">
      <ConversationListPane activeId={id} />
      <div className="flex-1 min-w-0">
        <ChatPane conversationId={id} />
      </div>
    </div>
  );
}
