// Login.
//
// Two doors on one screen, because the two audiences authenticate differently
// and pretending otherwise would break one of them:
//
//   PATIENT   taps their own name or photo. No password, no typing. This is
//             recognition, not authentication — asking someone with dementia
//             to recall a password works against the whole point of the app.
//
//   CAREGIVER / DOCTOR  email and password, against the backend. This is where
//             the JWT is actually obtained — the gap that previously left the
//             entire API unreachable and the AI layer dead.
//
// After a successful sign-in the role decides the destination, using the role
// returned with the token rather than a second request.

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkle, Stethoscope, Users } from "@phosphor-icons/react";

import Button from "../components/ui/Button";
import { login as loginRequest, getMe, hydratePatientsFromServer } from "../lib/api";
import { homeForRole, useAuth } from "../lib/auth";
import {
  ensureDemoPatient,
  listPatients,
  setActivePatientId,
  setPreviewMode,
} from "../lib/db";

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listPatients().then((rows) => {
      setPatients(rows);
      setIsLoadingPatients(false);
    });
  }, []);

  // Entering through the patient door is real use, never a preview — clear
  // the flag so a caregiver's earlier preview can't silence the patient's
  // own sessions.
  const handleSelectPatient = async (patientId) => {
    setPreviewMode(false);
    await setActivePatientId(patientId);
    navigate("/patient");
  };

  const handleDemoMode = async () => {
    setPreviewMode(false);
    const demoId = await ensureDemoPatient();
    await setActivePatientId(demoId);
    navigate("/patient");
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    setError("");
    setIsSigningIn(true);

    try {
      const { role } = await loginRequest({ email, password });

      // Populate auth context so the guards do not bounce the first render.
      const me = await getMe().catch(() => null);
      if (me) setUser(me);

      // Pull this caregiver's patients into IndexedDB before the dashboard
      // mounts, so a fresh device never opens on "No patients yet".
      if (role === "caregiver") {
        await hydratePatientsFromServer().catch(() => {});
      }

      navigate(homeForRole(role));
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex flex-col justify-center px-6 sm:px-8 max-w-md mx-auto w-full py-10">
        <div className="mb-8">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            <ArrowLeft size={18} weight="regular" />
            Back
          </Link>
          <h1 className="mt-6 font-display text-2xl sm:text-3xl text-neutral-800">
            Welcome
          </h1>
          <p className="mt-2 text-neutral-600">
            Choose how you would like to continue
          </p>
        </div>

        {/* ── Patient: tap to continue ──────────────────────────────── */}
        <div className="space-y-3">
          {!isLoadingPatients && patients.length > 0 && (
            <>
              <p className="text-sm font-medium text-neutral-500">Continue as</p>
              {patients.map((patient) => (
                <button
                  key={patient.id}
                  onClick={() => handleSelectPatient(patient.id)}
                  className="flex items-center gap-3 w-full text-left bg-white border
                    border-neutral-200 hover:border-primary-300 rounded-lg px-5 py-4
                    transition-colors"
                >
                  <PatientAvatar patient={patient} />
                  <span className="font-medium text-neutral-800 text-lg">
                    {patient.name}
                  </span>
                </button>
              ))}
            </>
          )}

          <button
            onClick={handleDemoMode}
            className="flex items-start gap-3 w-full text-left bg-white border
              border-neutral-200 hover:border-primary-300 rounded-lg px-5 py-4
              transition-colors"
          >
            <Sparkle
              size={24}
              weight="regular"
              className="mt-0.5 text-neutral-500 shrink-0"
            />
            <span>
              <span className="block font-medium text-neutral-800 text-lg">
                Try demo mode
              </span>
              <span className="block mt-1 text-sm text-neutral-500">
                Explore the patient experience — no setup needed
              </span>
            </span>
          </button>
        </div>

        {/* ── Caregiver / doctor: real sign-in ──────────────────────── */}
        <div className="mt-8 pt-8 border-t border-neutral-200">
          <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-500">
            <Stethoscope size={16} weight="regular" />
            Caregiver or doctor sign-in
          </p>

          <form onSubmit={handleSignIn} className="mt-4 space-y-3">
            <label className="block">
              <span className="block text-sm text-neutral-600 mb-1">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="username"
                className="w-full rounded-lg border border-neutral-200 px-4 py-3
                  text-neutral-800 placeholder:text-neutral-400
                  focus:border-primary-300 focus:outline-none transition-colors"
                placeholder="you@example.com"
              />
            </label>

            <label className="block">
              <span className="block text-sm text-neutral-600 mb-1">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-neutral-200 px-4 py-3
                  text-neutral-800 placeholder:text-neutral-400
                  focus:border-primary-300 focus:outline-none transition-colors"
              />
            </label>

            {error ? <p className="text-sm text-error">{error}</p> : null}

            <Button type="submit" disabled={isSigningIn} className="w-full">
              {isSigningIn ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <Link
            to="/caregiver"
            className="mt-4 flex items-start gap-3 w-full text-left bg-white border
              border-neutral-200 hover:border-primary-300 rounded-lg px-5 py-4
              transition-colors"
          >
            <Users
              size={24}
              weight="regular"
              className="mt-0.5 text-neutral-500 shrink-0"
            />
            <span>
              <span className="block font-medium text-neutral-800 text-lg">
                Continue offline as caregiver
              </span>
              <span className="block mt-1 text-sm text-neutral-500">
                Uses this device only — no account needed
              </span>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}

function PatientAvatar({ patient }) {
  if (patient.photo) {
    return (
      <img
        src={patient.photo}
        alt=""
        className="w-11 h-11 rounded-full object-cover shrink-0"
      />
    );
  }

  const initial = patient.name?.trim()?.[0]?.toUpperCase() || "?";
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center text-white font-medium text-lg shrink-0"
      style={{ backgroundColor: patient.avatarColor }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
