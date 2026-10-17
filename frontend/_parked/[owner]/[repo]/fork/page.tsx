import Link from "next/link";
import { GitBranch, Check, Info } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DataTypeBadge } from "@/components/data-type-badge";
import { getRepo } from "@/lib/data";

export default async function ForkPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const data = getRepo(owner, repo);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="size-4" />
            Create a new fork
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Fork {owner}/{repo}
          </h1>
          <p className="text-sm text-muted-foreground">
            A fork is a copy-on-write clone of a dataset repository. Large rasters and
            point clouds are shared by reference until you modify them, so forking a
            multi-gigabyte basin costs almost no storage.
          </p>
        </div>

        <Alert className="mt-6">
          <Info />
          <AlertTitle>Copy-on-write storage</AlertTitle>
          <AlertDescription>
            {data.size} of terrain and model data will be linked, not duplicated. You are
            billed only for tiles you change.
          </AlertDescription>
        </Alert>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Fork details</CardTitle>
            <CardDescription>
              Choose where this fork lives and how much history to copy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
                <Field>
                  <FieldLabel htmlFor="fork-owner">Owner</FieldLabel>
                  <Select defaultValue="you">
                    <SelectTrigger id="fork-owner">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="you">priyam</SelectItem>
                        <SelectItem value="hydrolab">hydrolab</SelectItem>
                        <SelectItem value="deltares">deltares</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="fork-name">Repository name</FieldLabel>
                  <Input id="fork-name" defaultValue={repo} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="fork-desc">Description</FieldLabel>
                <Textarea
                  id="fork-desc"
                  defaultValue={data.description}
                  rows={2}
                />
                <FieldDescription>
                  Optional. Explain how your fork differs from the upstream dataset.
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="default-only" defaultChecked />
                <FieldLabel htmlFor="default-only" className="font-normal">
                  Copy the {data.defaultBranch} branch only
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="lfs" defaultChecked />
                <FieldLabel htmlFor="lfs" className="font-normal">
                  Link large binary objects (recommended)
                </FieldLabel>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-3 border-t border-border">
            <div className="flex flex-wrap gap-1.5">
              {data.tags.map((t) => (
                <DataTypeBadge key={t} type={t} />
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" render={<Link href={`/${owner}/${repo}`} />}>
                Cancel
              </Button>
              <Button render={<Link href={`/priyam/${repo}`} />}>
                <Check data-icon="inline-start" />
                Create fork
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </AppShell>
  );
}
