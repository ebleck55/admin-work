import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Chief of Staff</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
