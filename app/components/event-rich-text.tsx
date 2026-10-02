import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Heading2, Quote, Undo2, Redo2 } from "lucide-react";
import { Button } from "./ui/button";
import { useState } from "react";

export function EventRichText({ initialValue }: { initialValue: string }) {
  const [html, setHtml] = useState(initialValue);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
    ],
    content: initialValue,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": "Event description",
        class:
          "min-h-40 px-3 py-3 outline-none [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_p]:mb-2",
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.isEmpty ? "" : editor.getHTML()),
  });
  const tools = [
    { label: "Bold", Icon: Bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Italic", Icon: Italic, run: () => editor?.chain().focus().toggleItalic().run() },
    {
      label: "Heading",
      Icon: Heading2,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bullet list",
      Icon: List,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      Icon: ListOrdered,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    { label: "Quote", Icon: Quote, run: () => editor?.chain().focus().toggleBlockquote().run() },
    { label: "Undo", Icon: Undo2, run: () => editor?.chain().focus().undo().run() },
    { label: "Redo", Icon: Redo2, run: () => editor?.chain().focus().redo().run() },
  ];
  return (
    <div className="overflow-hidden rounded-md border">
      <input type="hidden" name="description" value={html} />
      <div
        role="toolbar"
        aria-label="Description formatting"
        className="flex flex-wrap gap-1 border-b bg-muted/30 p-1"
      >
        {tools.map(({ label, Icon, run }) => (
          <Button
            key={label}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            disabled={!editor}
            onClick={run}
          >
            <Icon className="size-4" />
          </Button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
