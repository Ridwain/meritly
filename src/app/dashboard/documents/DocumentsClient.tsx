'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import {
  FileText,
  ExternalLink,
  X,
  CheckCircle2,
  AlertCircle,
  Plus,
  Edit3,
  Save,
  Bold,
  Italic,
  Underline,
  List,
  Heading1,
  Heading2,
  AlignLeft,
  AlignCenter,
  Bot,
  Send,
  User,
  Sparkles,
  Loader2,
  Trash2,
} from 'lucide-react';

interface Document {
  id: string;
  title: string;
  file_url: string;
  content?: string;
  created_at: string;
  updated_at?: string;
}

interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
}

export default function DocumentsClient({ userRole }: { userRole: string }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Document states
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showTopUpload, setShowTopUpload] = useState(false);

  // Chatbot states
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      sender: 'bot',
      text: 'Hello! I am your AI Document Assistant. Ask me anything about policies, notices, or contents across all uploaded documents!',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      if (Array.isArray(data)) {
        setDocuments(data);
        if (data.length > 0 && !selectedDoc) {
          selectDocument(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load documents', err);
    }
  };

  const selectDocument = (doc: Document) => {
    setSelectedDoc(doc);
    setEditTitle(doc.title);
    setEditContent(doc.content || '<p>Start typing document content here...</p>');
    setIsEditing(false);
    setSaveSuccess(false);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    setLoading(true);
    setErrorMsg(null);

    const formData = new FormData();
    if (file) formData.append('file', file);
    formData.append('title', title);
    formData.append('content', '<p>New document created. Click Edit to type content...</p>');

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create document');

      setTitle('');
      setFile(null);
      setShowTopUpload(false);

      const updatedRes = await fetch('/api/documents');
      const updatedData = await updatedRes.json();
      if (Array.isArray(updatedData) && updatedData.length > 0) {
        setDocuments(updatedData);
        selectDocument(updatedData[0]);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating document');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedDoc) return;
    setIsSaving(true);
    setErrorMsg(null);

    const updatedHTML = editorRef.current ? editorRef.current.innerHTML : editContent;

    try {
      const res = await fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedDoc.id,
          title: editTitle,
          content: updatedHTML,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save document changes');

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);

      fetchDocuments();
      if (data && data[0]) {
        setSelectedDoc(data[0]);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Gemini AI Chat Submit
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userQuery = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { sender: 'user', text: userQuery }]);
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/documents/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userQuery }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reach AI Chatbot');

      setChatMessages((prev) => [...prev, { sender: 'bot', text: data.reply }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'bot', text: `⚠️ Error: ${err.message || 'Unable to fetch response.'}` },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const executeCommand = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
  };

  const getFileExtension = (url: string) => {
    if (!url) return 'DOC';
    const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    return ext || 'DOC';
  };

  const isHrOrAdmin = userRole.toLowerCase() === 'hr' || userRole.toLowerCase() === 'admin';

  return (
    <div className="space-y-6 max-w-7xl pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Document Hub & Gemini Assistant</h1>
          <p className="text-sm text-slate-500">
            Edit documents in real time and ask our Gemini AI anything about your files.
          </p>
        </div>

        {isHrOrAdmin && (
          <Button
            onClick={() => setShowTopUpload(!showTopUpload)}
            className="bg-brand-600 hover:bg-brand-700 text-white flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>New Document</span>
          </Button>
        )}
      </div>

      {/* Upload Form Modal/Drawer */}
      {showTopUpload && isHrOrAdmin && (
        <Card className="p-6 border border-brand-200 bg-brand-50/40 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-md font-semibold text-slate-800">Create Blank Doc or Upload Attachment</h2>
            <button onClick={() => setShowTopUpload(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Document Title
                </label>
                <Input
                  placeholder="e.g., Company Remote Work Policy 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Optional File Attachment (.pdf, .doc)
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-slate-500 border border-slate-300 rounded-md p-1.5 bg-white cursor-pointer"
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="bg-brand-600 text-white">
              {loading ? 'Creating...' : 'Create & Open Editor'}
            </Button>
          </form>
        </Card>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Document Selector Badges */}
      <div className="space-y-2">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Available Documents ({documents.length})
        </h2>

        {documents.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No documents available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {documents.map((doc) => {
              const isSelected = selectedDoc?.id === doc.id;
              return (
                <button
                  key={doc.id}
                  onClick={() => selectDocument(doc)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-all flex items-center gap-2 ${
                    isSelected
                      ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="truncate max-w-[200px]">{doc.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* MAIN TWO-COLUMN WORKSPACE: LEFT = EDITOR/READER, RIGHT = GEMINI CHATBOT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Google Docs Editor Canvas */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          {selectedDoc ? (
            <Card className="border border-slate-300 bg-white shadow-md rounded-xl overflow-hidden">
              {/* Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileText className="h-6 w-6 text-brand-600 shrink-0" />
                  {isEditing ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="font-bold text-base bg-white border-slate-300"
                    />
                  ) : (
                    <div>
                      <h2 className="text-base font-bold text-slate-900 truncate">{selectedDoc.title}</h2>
                      <p className="text-[11px] text-slate-400">
                        Updated: {new Date(selectedDoc.updated_at || selectedDoc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {saveSuccess && (
                    <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" /> Saved
                    </span>
                  )}

                  {isHrOrAdmin && (
                    <>
                      {!isEditing ? (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg text-xs"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit Doc</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setIsEditing(false)}
                            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg text-xs"
                          >
                            Done
                          </button>
                          <button
                            onClick={handleSaveChanges}
                            disabled={isSaving}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg text-xs transition-colors"
                          >
                            <Save className="h-3.5 w-3.5" />
                            <span>{isSaving ? 'Saving...' : 'Save'}</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {selectedDoc.file_url && (
                    <a
                      href={selectedDoc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg"
                      title="Open attachment"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>

              {/* Formatting Toolbar */}
              {isEditing && (
                <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center gap-1 text-slate-700">
                  <button onClick={() => executeCommand('bold')} className="p-1.5 hover:bg-slate-200 rounded">
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => executeCommand('italic')} className="p-1.5 hover:bg-slate-200 rounded">
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => executeCommand('underline')} className="p-1.5 hover:bg-slate-200 rounded">
                    <Underline className="h-3.5 w-3.5" />
                  </button>
                  <div className="h-4 w-px bg-slate-300 mx-1" />
                  <button onClick={() => executeCommand('formatBlock', '<h1>')} className="p-1.5 hover:bg-slate-200 rounded">
                    <Heading1 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => executeCommand('formatBlock', '<h2>')} className="p-1.5 hover:bg-slate-200 rounded">
                    <Heading2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => executeCommand('insertUnorderedList')} className="p-1.5 hover:bg-slate-200 rounded">
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <div className="h-4 w-px bg-slate-300 mx-1" />
                  <button onClick={() => executeCommand('justifyLeft')} className="p-1.5 hover:bg-slate-200 rounded">
                    <AlignLeft className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => executeCommand('justifyCenter')} className="p-1.5 hover:bg-slate-200 rounded">
                    <AlignCenter className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Document Paper */}
              <div className="p-6 bg-slate-100 min-h-[500px]">
                <div className="w-full bg-white border border-slate-200 rounded-lg shadow-sm p-6 min-h-[460px]">
                  {isEditing ? (
                    <div
                      ref={editorRef}
                      contentEditable
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: editContent }}
                      className="outline-none min-h-[420px] prose prose-slate max-w-none text-slate-800 text-sm leading-relaxed"
                    />
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: selectedDoc.content || '<p className="text-slate-400 italic">No document text available.</p>',
                      }}
                      className="prose prose-slate max-w-none text-slate-800 text-sm leading-relaxed"
                    />
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <div className="p-12 text-center text-slate-400 border border-dashed rounded-xl">
              Select a document to view or edit.
            </div>
          )}
        </div>

        {/* Right Column (5 cols): GEMINI CHATBOT SIDEBAR */}
        <div className="lg:col-span-5 xl:col-span-4 sticky top-6">
          <Card className="border border-slate-300 bg-white shadow-md rounded-xl flex flex-col h-[650px]">
            {/* Chat Header */}
            <div className="p-4 bg-slate-900 text-white rounded-t-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-brand-500 rounded-lg text-white">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Gemini Doc Assistant</h3>
                  <p className="text-[10px] text-slate-300">Live AI search across all documents</p>
                </div>
              </div>

              <button
                onClick={() =>
                  setChatMessages([
                    {
                      sender: 'bot',
                      text: 'Chat history cleared. How can I help you with your documents?',
                    },
                  ])
                }
                className="text-slate-400 hover:text-white transition-colors"
                title="Clear Chat"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {/* Message Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/50">
              {chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-2.5 ${
                    msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-full shrink-0 ${
                      msg.sender === 'user'
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {msg.sender === 'user' ? (
                      <User className="h-3.5 w-3.5" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-brand-600" />
                    )}
                  </div>

                  <div
                    className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-brand-600 text-white rounded-tr-none'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-sm whitespace-pre-line'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {isChatLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
                  <span>Gemini is reading documents...</span>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200 rounded-b-xl flex gap-2">
              <Input
                placeholder="Ask about leave policy, guidelines..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="text-xs bg-slate-50 border-slate-300 focus:bg-white"
              />
              <Button
                type="submit"
                disabled={isChatLoading || !chatInput.trim()}
                className="bg-brand-600 hover:bg-brand-700 text-white shrink-0 px-3"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}