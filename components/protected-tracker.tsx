import { redirect } from "next/navigation";
import { account } from "@/lib/auth";
import TrackerApp, { type Page } from "./tracker-app";
export default async function ProtectedTracker({
  initialPage,
}: {
  initialPage: Page;
}) {
  const user = await account();
  if (!user) redirect("/signin");
  return <TrackerApp initialPage={initialPage} user={{ ...user }} />;
}
