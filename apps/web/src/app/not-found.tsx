import Link from "next/link";
import { Button } from "@mediqr/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FDF8F6] px-6 text-center text-[#2B2230]">
      <div className="max-w-md space-y-4">
        <span className="font-serif text-6xl font-bold text-plum-900">404</span>
        <h2 className="font-serif text-2xl font-bold text-plum-950">
          Page or Record Not Found
        </h2>
        <p className="text-sm text-ink-600">
          The requested clinical record, portal route, or resource is
          unavailable or has expired.
        </p>
        <div className="pt-4">
          <Link href="/">
            <Button variant="primary">Return to Health Portal</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
