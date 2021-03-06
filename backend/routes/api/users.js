const express = require("express");
const router = express.Router();
const userModel = require("../../models/User");
const watchedMovies = require("../../models/WatchedMovies");
const bcrypt = require("bcryptjs");
const config = require("config");
const { validationResult } = require("express-validator");
const fs = require("fs");
const { promisify } = require("util");
const unlinkAsync = promisify(fs.unlink);
const path = require("path");
const multer = require("multer");
const Jimp = require("jimp");
const _ = require("lodash");
const mongoose = require("mongoose");

const auth = require("../../middleware/auth");
const validatorController = require("../../controllers/validator.controller");

// router.post('/login', forwardAuthenticated, (req, res) => res.render('login'));
// router.get("/register", forwardAuthenticated, (req, res) =>
//   res.render("register")
// );

// Configure storage for multer
const storage = multer.diskStorage({
  destination: function(req, file, callback) {
    const dir = config.get("profileImages");
    fs.exists(dir, exists => {
      if (!exists) {
        return fs.mkdir(dir, error => callback(error, dir));
      }
      return callback(null, dir);
    });
  },
  filename: function(req, file, callback) {
    return callback(
      null,
      "IMAGE-" + Date.now() + path.extname(file.originalname)
    );
  }
});

// Set file size limit, and allowed extensions
const upload = multer({
  storage: storage,
  limits: { fileSize: 2000000 },
  fileFilter: (req, file, callback) => {
    // allowed extensions
    const fileTypes = /jpeg|jpg|png/;
    const extname = fileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimeType = fileTypes.test(file.mimetype);
    return extname && mimeType
      ? callback(null, true)
      : callback("Invalid Profile Image");
  }
}).single("profileImage");

// @route   GET api/users/me
// @desc    Get logged user info
// @access  Private
router.get("/me", [auth], async (req, res) => {
  try {
    const { user } = req;
    return res.json({ user });
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

// @route   GET api/users/me
// @desc    Get logged user info
// @access  Private
router.get("/info/:id?", [auth], async (req, res) => {
  let id = req.params.id;
  if (id === "undefined") id = req.id;
  try {
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);
    if (!isValidObjectId)
      return res.status(404).json({ msg: "User not found" });
    const user = await userModel.findOne({ _id: mongoose.Types.ObjectId(id) });
    if (user) return res.json({ user });
    return res.status(404).json({ msg: "User not found" });
  } catch (error) {
    return res.status(500).json({ msg: "Server Error" });
  }
});

// @route   POST api/users/update
// @desc    Upload profile info
// @access  Private
router.post(
  "/update",
  [auth, validatorController.validateUpdateUser],
  async (req, res) => {
    //Check errors
    let validationErrors = validationResult(req);

    if (!validationErrors.isEmpty()) {
      const errors = _(validationErrors.array())
        .groupBy("param")
        .mapValues(group => _.map(group, "msg")[0])
        .value();
      return res.status(400).json({
        msg: "Please fill the form with correct informations",
        errors
      });
    }

    const { id } = req;
    const { strategy } = req.user;
    const {
      first_name,
      last_name,
      username,
      email,
      oldPassword,
      newPassword
    } = req.body;

    try {
      const user = await userModel.findOne({ _id: id });
      if (!user) return res.status(404).json({ msg: "Invalid User" });

      // if user connected using oauth, don't compare password
      const matched =
        strategy !== "omniauth"
          ? await bcrypt.compare(oldPassword, user.password)
          : true;
      if (!matched)
        return res.status(400).json({ msg: "Invalid Old Password" });

      // check username if unique
      const usernameExists = await userModel.findOne({
        username,
        _id: { $ne: id }
      });
      if (usernameExists)
        return res.status(400).json({
          msg: "Choose another username",
          errors: { username: "Already exists" }
        });

      // check username if unique
      const emailExists = await userModel.findOne({ email, _id: { $ne: id } });
      if (emailExists)
        return res.status(400).json({
          msg: "Choose another email",
          errors: { email: "Already exists" }
        });

      user.first_name = first_name;
      user.last_name = last_name;
      user.username = username;
      user.email = email;
      // if user set new password
      if (newPassword !== "") user.password = newPassword;

      await user.save();
      return res.json({ msg: "Updated Successfuly" });
    } catch (error) {
      res.status(500).json({ msg: "Server error" });
    }
  }
);

// @route   POST api/users/image
// @desc    Upload profile image
// @access  Private
router.post("/image", auth, async (req, res) => {
  try {
    upload(req, res, async function(err) {
      if (err) {
        return res.status(400).json({ msg: err });
      }

      new Jimp(req.file.path, async function(err, image) {
        if (!err) {
          // Everything went fine.
          const user = await userModel.findOneAndUpdate(
            { _id: req.id },
            { profileImage: req.file.filename }
          );
          if (user) return res.json(req.file.filename);
          return res.status(404).json({ msg: "User not Found" });
        }
        await unlinkAsync(req.file.path);
        return res.status(400).send({ msg: "Invalid Profile Image" });
      });
    });
  } catch (error) {
    res.status(500).json({ msg: "Server error" });
  }
});

// @route   Post api/users/watched
// @desc    Record watched movie
// @access  Private
router.post("/watched", 
  [auth, validatorController.validateWatched], 
  async (req, res) => {
  //Check errors
  let validationErrors = validationResult(req);
  if (!validationErrors.isEmpty()) {
    return res.status(400).json({
      msg: "Unvalid movie data",
    });
  }

  try {
    const { imdb_code, title, year, rating, poster } = req.body;
    const { id } = req;

    let result = await watchedMovies.findOne({
      user: id,
      imdb_code: imdb_code
    });
    if (!result) {
      const watched = new watchedMovies({
        user: id,
        imdb_code,
        title,
        year,
        rating,
        poster
      });
      await watched.save();
    }
    return res.send("Success");
  } catch (error) {
    return res.status(500).json({ msg: "Server error.." });
  }
});

// @route   Get api/users/watched
// @desc    Get user watched movies
// @access  Private
router.get("/watched/:id?", [auth], async (req, res) => {
  try {
    id = req.params.id;
    if (req.params.id === "undefined") id = req.id;
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);
    if (!isValidObjectId)
      return res.status(404).json({ msg: "User not found" });
    const watched = await watchedMovies
      .find({ user: mongoose.Types.ObjectId(id) })
      .sort({ date: -1 })
      .limit(5);

    return res.json(watched);
  } catch (error) {
    return res.status(500).json({ msg: "Server error!" });
  }
});

module.exports = router;
