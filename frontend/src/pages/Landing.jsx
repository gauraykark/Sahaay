import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Main content */}
      <main className="flex-1 flex flex-col justify-center px-6 sm:px-8 max-w-lg mx-auto w-full">
        
        {/* Brand */}
        <div className="mb-10">
          <h1 className="font-display text-3xl sm:text-4xl text-neutral-800 tracking-tight">
            Sahaay
          </h1>
          <p className="mt-3 text-lg text-neutral-600 leading-relaxed">
            Gentle cognitive support for everyday memory and daily routines.
          </p>
        </div>

        {/* Primary action */}
        <div className="space-y-4">
          <Link
            to="/login"
            className="block w-full text-center bg-primary-600 hover:bg-primary-700 text-white text-lg font-medium py-3.5 px-6 rounded-lg transition-colors"
          >
            Get Started
          </Link>

          <Link
            to="/caregiver"
            className="block w-full text-center text-neutral-600 hover:text-neutral-800 text-base py-2 transition-colors"
          >
            I am a caregiver
          </Link>
        </div>
      </main>

      {/* Quiet footer */}
      <footer className="px-6 py-5 text-center">
        <p className="text-sm text-neutral-500">
          Designed for elderly users and their families
        </p>
      </footer>
    </div>
  );
}