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
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
