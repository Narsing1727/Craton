"use client";

import { useState } from "react";
import { Key, Plus, Trash2 } from "lucide-react";
import { SettingsNav } from "@/components/settings-nav";
import { ConfirmAction } from "@/components/craton-actions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { sshKeys as initialKeys } from "@/lib/data";



export default function SshKeysPage() {
  const [keys, setKeys] = useState(initialKeys);
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState("");
  const [keyContent, setKeyContent] = useState("");

  function handleAddKey(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !keyContent.trim()) {
      toast.error("Please fill in both title and key content");
      return;
    }

    const newKey = {
      name: title.trim(),
      fingerprint: `SHA256:${Math.random().toString(36).substring(2, 8)}…${Math.random().toString(36).substring(2, 6)}`,
      created: "Just now",
      lastUsed: "Never",
    };

    setKeys([...keys, newKey]);
    setTitle("");
    setKeyContent("");
    setShowAddForm(false);
    toast.success(`SSH key "${title}" added successfully!`);
  }

  function handleDeleteKey(name: string) {
    setKeys(keys.filter((k) => k.name !== name));
    toast.info(`Deleted key "${name}"`);
  }

  return (
    <AppShell>
      <div className="grid grid-cols-1 w-full gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-8 md:grid-cols-[240px_1fr] max-w-6xl mx-auto">
        {/* Settings Navigation Sidebar */}
        <SettingsNav active="ssh-keys" />

        {/* Content */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div>
              <h2 className="text-xl font-semibold">SSH keys</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage SSH keys associated with your account for CLI authentication and dataset pushing.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowAddForm(!showAddForm)} className="gap-1.5">
              <Plus className="size-3.5" /> New SSH key
            </Button>
          </div>

          {/* Add Form */}
          {showAddForm && (
            <Card className="p-5 border-primary/40 bg-muted/20">
              <form onSubmit={handleAddKey} className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold">Add new SSH key</h3>
                <div>
                  <label htmlFor="key-title" className="block text-xs font-medium text-muted-foreground mb-1">
                    Title
                  </label>
                  <Input
                    id="key-title"
                    placeholder="e.g. Workstation or MacBook Pro"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="key-body" className="block text-xs font-medium text-muted-foreground mb-1">
                    Key
                  </label>
                  <Textarea
                    id="key-body"
                    placeholder="Begins with 'ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256'..."
                    rows={5}
                    value={keyContent}
                    onChange={(e) => setKeyContent(e.target.value)}
                    className="font-mono text-xs"
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm">
                    Add SSH key
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {/* Existing Keys List */}
          <Card className="overflow-hidden py-0">
            <ul className="divide-y divide-border text-sm">
              {keys.map((k) => (
                <li key={k.name} className="flex items-center justify-between p-4 hover:bg-muted/20">
                  <div className="flex items-start gap-3">
                    <Key className="size-5 mt-0.5 text-accent shrink-0" />
                    <div>
                      <h3 className="font-semibold text-sm">{k.name}</h3>
                      <p className="font-mono text-xs text-muted-foreground mt-0.5">{k.fingerprint}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5">
                        <span>Added {k.created}</span>
                        <span>&middot;</span>
                        <span>Last used {k.lastUsed}</span>
                      </div>
                    </div>
                  </div>

                  <ConfirmAction
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete SSH key ${k.name}`}
                        title="Delete SSH key"
                      >
                        <Trash2 />
                      </Button>
                    }
                    title={`Delete SSH key “${k.name}”?`}
                    description="Any machine using this key will no longer be able to push or pull over SSH."
                    confirmLabel="Delete key"
                    onConfirm={() => handleDeleteKey(k.name)}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* Help box */}
          <div className="rounded-lg border border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">How to generate an SSH key?</p>
            <p className="leading-relaxed">
              Open your terminal and run: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">ssh-keygen -t ed25519 -C "your_email@example.com"</code>.
              When prompted, accept the default file location, then copy your public key from <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">~/.ssh/id_ed25519.pub</code>.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
