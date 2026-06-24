/**
 * Animated skeleton placeholders for loading states. The default export is the
 * single-block skeleton; `TableSkeleton` produces a multi-row layout.
 *
 * Backed by the existing implementation at `../Skeleton` to avoid breaking
 * existing imports.
 */
import { Skeleton, TableSkeleton } from "../Skeleton";

export { Skeleton, TableSkeleton };
export const LoadingSkeleton = Skeleton;
export default Skeleton;
