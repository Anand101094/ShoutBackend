const functions = require("firebase-functions");

const express = require("express");
const cors = require("cors")
const app = express();

app.use(cors({ origin: true }));

const fbAuth = require("./util/fbAuth");
const { db } = require("./util/admin");

const {
  getAllShouts,
  postShout,
  getShout,
  commentonShout,
  likeShout,
  unlikeShout,
  deleteShout
} = require("./handlers/shouts");
const {
  signUp,
  login,
  uploadImage,
  addUserDetail,
  getAuthenticatedUser,
  getUserDetails,
  markNotificationsRead
} = require("./handlers/users");

// shout route
app.get("/shouts", getAllShouts);
app.post("/shout", fbAuth, postShout);
app.get("/shout/:shoutId", getShout);
app.post("/shout/:shoutId/comment", fbAuth, commentonShout);
app.get("/shout/:shoutId/like", fbAuth, likeShout);
app.get("/shout/:shoutId/unlike", fbAuth, unlikeShout);
app.delete("/shout/:shoutId", fbAuth, deleteShout);

// users route
app.post("/signup", signUp);
app.post("/login", login);
app.post("/user/image", fbAuth, uploadImage);
app.post("/user", fbAuth, addUserDetail);
app.get("/user", fbAuth, getAuthenticatedUser);
app.get("/user/:username", getUserDetails);
app.post("/notifications", fbAuth, markNotificationsRead);

exports.api = functions.https.onRequest(app);

exports.createNotificationOnLike = functions.firestore
  .document("likes/{id}")
  .onCreate((snapshot) => {
    return db
      .doc(`/shouts/${snapshot.data().shoutId}`)
      .get()
      .then((doc) => {
        if (doc.exists && doc.data().userName !== snapshot.data().userName) {
          return db.doc(`/notifications/${snapshot.id}`).set({
            createdAt: new Date().toISOString,
            recipient: doc.data().userName,
            sender: snapshot.data().userName,
            type: "like",
            read: false,
            shoutId: doc.id
          });
        }
      })
      .catch((error) => {
        console.error(error);
        return;
      });
  });

exports.deleteNotificationOnUnlike = functions.firestore
  .document("likes/{id}")
  .onDelete((snapshot) => {
    return db
      .doc(`/notifications/${snapshot.id}`)
      .delete()
      .catch((error) => {
        console.error(error);
        return;
      });
  });

exports.createNotificationOnComment = functions.firestore
  .document("comment/{id}")
  .onCreate((snapshot) => {
    return db
      .doc(`/shouts/${snapshot.data().shoutId}`)
      .get()
      .then((doc) => {
        if (doc.exists && doc.data().userName !== snapshot.data().userName) {
          return db.doc(`/notifications/${snapshot.id}`).set({
            createdAt: new Date().toISOString,
            recipient: doc.data().userName,
            sender: snapshot.data().userName,
            type: "comment",
            read: false,
            shoutId: doc.id
          });
        }
      })
      .catch((error) => {
        console.error(error);
        return;
      });
  });

exports.onUserImageChange = functions.firestore
  .document("/users/{id}")
  .onUpdate((change) => {
    if (change.before.data().imageUrl !== change.after.data().imageUrl) {
      let batch = db.batch();
      return db
        .collection("shouts")
        .where("userName", "==", change.before.data().userName)
        .get()
        .then((data) => {
          data.forEach((doc) => {
            const shout = db.doc(`/shouts/${doc.id}`);
            batch.update(shout, { userImage: change.after.data().imageUrl });
          });
          return batch.commit();
        });
    } else return true;
  });

exports.onShoutDelete = functions.firestore
  .document("/shouts/{shoutId}")
  .onDelete((snapshot, context) => {
    const shoutId = context.params.shoutId;
    const batch = db.batch();
    return db
      .collection("comments")
      .where("shoutId", "==", shoutId)
      .get()
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/comments/${doc.id}`));
        });
        return db
          .collection("likes")
          .where("shoutId", "==", shoutId)
          .get();
      })
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/likes/${doc.id}`));
        });
        return db
          .collection("notifications")
          .where("shoutId", "==", shoutId)
          .get();
      })
      .then((data) => {
        data.forEach((doc) => {
          batch.delete(db.doc(`/notifications/${doc.id}`));
        });
        return batch.commit();
      })
      .catch((error) => {
        console.error(error);
      });
  });
