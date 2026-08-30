import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider, RequireRole } from "./lib/auth";

import ItemPreview from "./pages/ItemPreview";
import PlayDomain from "./pages/PlayDomain";
import PlaySession from "./pages/PlaySession";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import PatientHome from "./pages/PatientHome";
import MemoryVault from "./pages/MemoryVault";
import CaregiverDashboard from "./pages/CaregiverDashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import PatientClinicalView from "./pages/PatientClinicalView";


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

          {/* One route for all six domains. The four /patient/game/* routes
              are gone with the games that owned them. */}
          <Route path="/patient/play" element={<PlaySession />} />
          <Route path="/patient/play/:domain" element={<PlayDomain />} />

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

          {/* Developer surface: one item per domain at levels 0/7/15.
              Not patient-facing, nothing here is scored or logged.
              Remove once the six games exist and can be played directly. */}
          <Route path="/preview/items" element={<ItemPreview />} />

          <Route path="*" element={<Landing />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
