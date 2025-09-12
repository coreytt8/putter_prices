// app/putters/error.tsx
"use client";
export default function Error({ error }: { error: Error }) {
  return (
    <div className="p-6 text-red-700 bg-red-50 rounded-md">
      Something went wrong: {error.message}
    </div>
  );
}
