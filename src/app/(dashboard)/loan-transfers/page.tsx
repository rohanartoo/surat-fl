import { redirect } from "next/navigation"
import { getProfile, canActAsAuctionMaster } from "@/lib/roles"
import { LoanTransferManager } from "@/components/loan-transfers/LoanTransferManager"

export default async function LoanTransfersPage() {
  const profile = await getProfile()
  if (!profile || !(await canActAsAuctionMaster())) redirect("/dashboard")

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Loan Transfers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Execute a same-position player swap between two teams, with optional cash, on behalf of the AM/admin.
        </p>
      </div>
      <LoanTransferManager />
    </div>
  )
}
