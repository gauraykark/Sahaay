import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider, RequireRole } from "./lib/auth";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import PatientHome from "./pages/PatientHome";
import MemoryVault from "./pages/MemoryVault";
import CaregiverDashboard from "./pages/CaregiverDashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import PatientClinicalView from "./pages/PatientClinicalView";

import MemoryGame from "./components/games/MemoryGame";
import RoutineGame from "./components/games/RoutineGame";
import ObjectsGame from "./components/games/ObjectsGame";
import NameRecallGame from "./components/games/NameRecallGame";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* PATIENT — deliberately unguarded.
              The patient side is reached by tapping a name on this device, not
              by signing in. Requiring a login here would mean asking someone
              with dementia to recall a password, which works against the point
              of the app. The boundary that matters is patient vs caregiver,
              and that is the PIN plus the server's role checks. */}
          <Route path="/patient" element={<PatientHome />} />
          <Route path="/patient/vault" element={<MemoryVault />} />
          <Route path="/patient/game/memory" element={<MemoryGame />} />
          <Route path="/patient/game/routine" element={<RoutineGame />} />
          <Route path="/patient/game/objects" element={<ObjectsGame />} />
          <Route path="/patient/game/name-recall" element={<NameRecallGame />} />

          {/* CAREGIVER — the PIN gate lives inside the component and stays as
              a local convenience lock. The server still checks the role. */}
          <Route path="/caregiver" element={<CaregiverDashboard />} />

          {/* DOCTOR — reads other people's patients, so it is guarded on both
              sides: this wrapper for navigation, require_role on every
              endpoint it calls. */}
          <Route
            path="/doctor"
            element={
              <RequireRole roles={["doctor"]}>
                <DoctorDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/doctor/patient/:patientId"
            element={
              <RequireRole roles={["doctor"]}>
                <PatientClinicalView />
              </RequireRole>
            }
          />

          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
