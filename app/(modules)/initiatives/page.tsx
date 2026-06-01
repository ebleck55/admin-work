import { ModuleDashboard, type SignalFilterParams } from "@/components/ModuleDashboard";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SignalFilterParams>;
}) {
  const filters = await searchParams;
  return <ModuleDashboard moduleId="initiatives" filters={filters} />;
}
