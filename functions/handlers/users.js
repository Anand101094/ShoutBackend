const { db, admin } = require('../util/admin')

const config = require('../util/config')

const firebase = require('firebase')
firebase.initializeApp(config)

const { validateSignUpData, validateLoginData, reduceUserDetails } =  require('../util/validator')

exports.signUp = (req,res)=> {

    let token, userId;

    const newUser = {
        email:req.body.email,
        password:req.body.password,
        confirmPassword:req.body.confirmPassword,
        userName:req.body.userName
    }

    const { valid , errors } = validateSignUpData(newUser)

    if(!valid) {
        return res.status(400).json({errors})
    }

    const noImage = 'default.png'

    db.doc(`/users/${newUser.userName}`).get()
    .then(doc => {
        if(doc.exists){
            return res.status(400).json({error: 'userName is already taken'})
        }else{
           return firebase.auth().createUserWithEmailAndPassword(newUser.email, newUser.password)
        }
    }).then(data => {
        userId =  data.user.uid;
        return data.user.getIdToken()
    }).then(tokenId => {
        token=tokenId;
        const userCredential = {
            userName: newUser.userName,
            email:newUser.email,
            createdAt: new Date().toISOString(),
            imageUrl:`https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${noImage}?alt=media`,
            userId:userId
        }

        return db.doc(`/users/${newUser.userName}`).set(userCredential)
    }).then(()=>{
        return res.status(201).json({token})
    })
    .catch(err=>{
        console.error(err)
        if(err.code === "auth/email-already-in-use"){
            return res.status(400).json({error:'Email already in use'})
        } else{
            res.status(500).json({general:"Something went wrong, Please try again"})
        }
    })
}

exports.login = (req, res) => {
    const user ={
        email: req.body.email,
        password : req.body.password
    }

    const { valid , errors } = validateLoginData(user)
    
    if(!valid) {
        return res.status(400).json({errors})
    }

    firebase.auth().signInWithEmailAndPassword(user.email, user.password)
    .then(data => {
        return data.user.getIdToken()
    })
    .then(token => {
        return res.json({token})
    })
    .catch(errors => {
        console.log(errors)
        if(errors.code === "auth/wrong-password"){
            return res.status(403).json({general : "Wrong credentials, Pleaswe try again" })
        } else return res.status(500).json({errors})
    })
}

// add user detail
exports.addUserDetail = (req, res) => {
    let userDetails = reduceUserDetails(req.body)
    db.doc(`/users/${req.user.userName}`).update(userDetails)
    .then(()=>{
        return res.json({message: "Details added successfully"})
    })
    .catch(err => {
        console.error(err)
        return res.status(500).json({error: err.code})
    })
}

// get any user details
exports.getUserDetails = (req, res) => {
    let userData ={}
    db.doc(`/users/${req.params.userName}`).get()
    .then(doc => {
        if(doc.exists){
            userData.user = doc.data()
            return db.collection('shouts').where('userName', '==', req.params.userName)
            .orderBy('createdAt', 'desc')
            .get()
        } else{
            return res.status(404).json({message:"User not found"})
        }
    })
    .then(data => {
        userData.shouts =[]
        data.forEach(doc => {
            userData.shouts.push({
                body: doc.data().body,
                createdAt: doc.data().createdAt,
                userName: doc.data().userName,
                userImage: doc.data().userImage,
                likeCount: doc.data().likeCount,
                commentCount: doc.data().commentCount,
                shoutId: doc.id,
            })
        })
        return res.json(userData)
    })
    .catch(error => {
        console.error(error)
        res.status(500).json({error})
    })
}

//get user dedtails
exports.getAuthenticatedUser = (req, res) => {
    let userData = {}
    db.doc(`/users/${req.user.userName}`).get()
    .then(doc => {
        if(doc.exists){
            userData.credentials = doc.data();
            return db.collection('likes').where('userName', '==', req.user.userName).get()

        }
    })
    .then(data => {
        userData.likes = []
        data.forEach(doc => {
            userData.likes.push(doc.data())
        })
        return db.collection('notifications').where('recipient', '==', req.user.userName)
        .orderBy('createdAt', 'desc').limit(10).get()
    })
    .then(data =>{
        userData.notifications =[]
        data.forEach(doc=>{
            userData.notifications.push({
                recipient: doc.data().recipient,
                sender: doc.data().sender,
                createdAt: doc.data().createdAt,
                shoutId: doc.data().shoutId,
                type: doc.data().type,
                read: doc.data().read,
                notificationId: doc.id
            })
        })
        return res.json(userData)
    })
    .catch(error => {
        console.error(error)
        res.status(500).json({error})
    })
}

// upload user image
exports.uploadImage = (req, res) => {
    const BusBoy = require('busboy')
    const path = require('path')
    const os = require('os')
    const fs = require('fs')

    const busBoy =  new BusBoy({ headers: req.headers})
    let imageFileName;
    let imageToBeUploaded;

    busBoy.on('file', (fieldname, file, filename, encoding, mimetype) =>{
        if(mimetype !== 'image/jpeg' && mimetype !== 'imgge/png'){
            return res.status(400).json({error: "Wrong file type submitted"})
        }
        const imageExtension = filename.split('.')[filename.split('.').length - 1]
        imageFileName = `${Math.round(Math.random()* 100000000)}.${imageExtension}`
        const filePath = path.join(os.tmpdir(), imageFileName)
        imageToBeUploaded = {filePath, mimetype}
        file.pipe(fs.createWriteStream(filePath))
    })

    busBoy.on('finish', ()=>{
        admin.storage().bucket().upload(imageToBeUploaded.filePath, {
            resumable: false,
            metadata: {
                metadata:{
                    contentType: imageToBeUploaded.mimetype
                }
            }
        })
        .then(()=>{
            const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${imageFileName}?alt=media`
            return db.doc(`/users/${req.user.userName}`).update({imageUrl})
        })
        .then(() => {
            return res.json({message: "Image uploaded successfully"})
        })
        .catch((error) => {
            console.error(error)
            return res.status(500).json({error})
        })
    })
    busBoy.end(req.rawBody)
}

exports.markNotificationsRead = (re, res) => {
    let batch = db.batch();
    req.body.forEach(notificationId => {
        const notification = db.doc(`/notifications/${notificationId}`)
        batch.update(notification, {read: true})
    })
    batch.commit()
    .then(()=>{
        return res.json({message: "Notifications marked read"})
    })
    .catch(error=>{
        console.error(error)
        return res.status(500).json({error})
    })
}
