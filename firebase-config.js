// Firebase configuration.
//
// 1. Create a free Firebase project at https://console.firebase.google.com
// 2. Add a Web app to the project (the </> icon).
// 3. Copy the values from the snippet they show you into the object below.
// 4. In the Firebase console:
//    - Authentication -> Sign-in method -> enable "Anonymous"
//    - Firestore Database -> Create database (in production mode)
//    - Firestore Database -> Rules: paste the rules from README.md
//    - Authentication -> Settings -> Authorized domains -> add your GitHub Pages
//      domain (e.g. coghillb.github.io)
// 5. Commit & push. Sync goes live as soon as the placeholders below are gone.
//
// These values are NOT secret. Firebase web configs are public by design — security
// comes from the Firestore rules and authorized domains, not from hiding the keys.

export const firebaseConfig = {
  apiKey: "AIzaSyDrSP0gKhZRzerj5RyxtDMbHkKzW5wVT0M",
  authDomain: "budget-quest-ac4be.firebaseapp.com",
  projectId: "budget-quest-ac4be",
  storageBucket: "budget-quest-ac4be.firebasestorage.app",
  messagingSenderId: "150257518386",
  appId: "1:150257518386:web:a5b5a32f004f9c89caf92b",
  measurementId: "G-VZT7GC0Z3B"
};
