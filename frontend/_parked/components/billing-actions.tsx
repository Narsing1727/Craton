"use client";

import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CancelSubscriptionButton({ org, plan, periodEnd }: { org: string; plan: string; periodEnd: string }) {
  return (
    <ConfirmAction
      trigger={<Button variant="outline">Cancel subscription</Button>}
      title={`Cancel the ${plan} plan for ${org}?`}
      description={`Private repositories become read-only on ${periodEnd}, when the current period ends. Public repositories and shared data stay available.`}
      confirmLabel="Cancel subscription"
      onConfirm={() =>
        toast.success("Subscription will end on " + periodEnd, {
          description: "You can resubscribe any time before then without losing anything.",
        })
      }
    />
  );
}

/** Card details are handled by the payment provider's hosted portal, never by Craton. */
export function UpdatePaymentButton() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm">Update</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden />
            Update payment method
          </DialogTitle>
          <DialogDescription>
            Card details are entered on the payment provider’s secure page. Craton never sees or stores card numbers.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <DialogClose
            render={
              <Button
                onClick={() =>
                  toast.info("Billing portal not connected yet", {
                    description: "It opens here once the payments backend is live.",
                  })
                }
              >
                Continue to billing portal
                <ExternalLink data-icon="inline-end" />
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
