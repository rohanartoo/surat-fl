import { Badge } from "@/components/ui/badge"
import { positionColor, cn } from "@/lib/utils"

export function PositionBadge({ position, className }: { position: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs w-10 justify-center font-medium border-0 bg-secondary shrink-0",
        positionColor(position),
        className,
      )}
    >
      {position}
    </Badge>
  )
}
