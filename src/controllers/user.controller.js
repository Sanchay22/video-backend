import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.models.js";
import { deleteCloudinary, uploadCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken"
const generateAccessAndRefreshTokens=async(userId)=>{
    //remember whenever this controller is called just dont ever change the parameters name otherwise error will be called
    try {
        const user=await User.findById(userId);
        const accessTokenpr=user.generateAccessToken()
        const refreshTokenpr=user.generateRefreshToken()
        let refreshToken;
        await refreshTokenpr.then((token)=>{refreshToken=token})
        user.refreshToken=refreshToken
        await user.save({validateBeforeSave:false})
        return {accessTokenpr,refreshTokenpr};
    } catch (error) {
        throw new ApiError(500,"Something went wrong while generating access and refresh tokens")
    }
}
const registerUser=asyncHandler( async (req,res)=>{
    // get user details from frontend like username fullname password coverimage email etc
    // vailidation -not empty
    // check if user already exists: username ,email
    // check for images, check for avatar
    // upload to cloudinary,avatar check
    // get url from cloudinary
    // create user object-create entry in db
    // remove password and refresh token field from response
    // check for user creeation
    // return result
    const {fullname,email,username, password}=req.body
    console.log(fullname);
    console.log(email);
    if(
        [fullname,email,username,password].some((field) => field?.trim() === "")
    ){
        throw new ApiError(400, "All fields are required")
    }
    const existedUser=await User.findOne({
        $or: [{ username },{ email }]
    })
    if(existedUser){
        throw new ApiError(409, "User with email or username exists")
    }
    const avatarLocalPath=req.files?.avatar[0]?.path
    // const coverImageLocalPath=req.files?.coverImage[0]?.path
    let coverImageLocalPath;
    if(req.files&& Array.isArray(req.files.coverImage)&& req.files.coverImage.length>0){
        coverImageLocalPath=req.files.coverImage[0].path
    }
    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar file is required")
    }
    const avatar=await uploadCloudinary(avatarLocalPath);
    const coverImage=await uploadCloudinary(coverImageLocalPath);
    if(!avatar){
        throw new ApiError(400,"Avatar file is required")
    }
    const user=await User.create({
        fullname,
        avatar:avatar.url,
        coverImage:coverImage?.url||"",
        email,
        password,
        username:username.toLowerCase()
    })
    const createdUser=await User.findById(user._id).select(
        "-password -refreshToken"
    )
    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering the user")
    }
    return res.status(201).json(
        new ApiResponse(200,createdUser,"User registered Successfully")
    )
})
const loginUser= asyncHandler(async(req,res)=>{
    //req body->data
    // username or email
    // find the user
    // password check
    // access and refresh token 
    // send cookie
    const {email,username,password}=req.body
    if(!(username||email)){
        throw new ApiError(400,"username or password is required")
    }const user=await User.findOne({$or:[{username},{email}]})
    if(!user){
        throw new ApiError(404,"User does not exist");
    }const isPasswordValid=await user.isPasswordCorrect(password)
    if(!isPasswordValid){
        throw new ApiError(401,"Incorrect Password")
    }
    const {accessTokenpr,refreshTokenpr}=await generateAccessAndRefreshTokens(user._id)
    let accessToken;
    let refreshToken;
    await accessTokenpr.then((token)=>{
        accessToken=token;
       }).catch(error => {
        console.error('accessToken promise Error:', error);
    });
       await refreshTokenpr.then((token)=>{
        refreshToken=token;
       }).catch(error => {
        console.error('refreshToken promise Error:', error);
    });
    const loggedInUser=await User.findById(user._id).select("-password -refreshToken")
    const options={
        httpOnly:true,
        secure:true
    }
    return res
    .status(200)
    .cookie("accessToken",accessToken,options)
    .cookie("refreshToken",refreshToken,options)
    .json(
        new ApiResponse(200,
        {
            user:loggedInUser,accessToken,refreshToken
        },
        "User logged in successfully"
    )
    )
})
const logoutUser=asyncHandler(async(req,res)=>{
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset:{
                refreshToken:1
            }
        },{
            new:true
        }
    )
    const options={
        httpOnly:true,
        secure:true
    }
    return res
    .status(200)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json(new ApiResponse(200,{},"User logged out"))
})

const refreshAccessToken=asyncHandler(async(req,res)=>{
    const incomingRefreshToken=req.cookies.refreshToken||req.body.refreshToken
    if(!incomingRefreshToken){
        throw new ApiError(401,"Unauthorized request")
    }
    try {
        const decodedToken=jwt.verify(incomingRefreshToken,process.env.REFRESH_TOKEN_SECRET)
        const user=await User.findById(decodedToken?._id)
        
        if(!user){
            throw new ApiError(401,"Unauthorized request")
        }if(incomingRefreshToken!==user?.refreshToken){
            throw new ApiError(401,"Refresh Token is expired or used")
        }
        const {accessTokenpr,refreshTokenpr}=await generateAccessAndRefreshTokens(user._id)
        let newrefreshToken;
        let accessToken;
        await accessTokenpr.then((token)=>{
            accessToken=token;
           }).catch(error => {
            console.error('accessToken promise Error:', error);
        });
           await refreshTokenpr.then((token)=>{
            newrefreshToken=token;
           }).catch(error => {
            console.error('refreshToken promise Error:', error);
        });console.log(newrefreshToken)
        const options={
            httpOnly:true,
            secure:true
        }
        return res
        .status(200)
        .cookie("accessToken",accessToken,options)
        .cookie("refreshToken",newrefreshToken,options)
        .json(
            new ApiResponse(200,
            {
                accessToken,refreshToken:newrefreshToken
            },
            "Access Token Refreshed")
        )
    } catch (error) {
        throw new ApiError(401, error?.message||"Invalid refresh token")
    }
})
const changeCurrentPassword= asyncHandler(async(req,res)=>{
    const {oldPassword,newPassword}=req.body;
    const user=await User.findById(req.user?._id)
    const isPasswordCorrect=await user.isPasswordCorrect(oldPassword)
    if(!isPasswordCorrect){
        throw new ApiError(400,"Invalid old password")
    }user.password=newPassword;
    await user.save({validateBeforeSave:false})
    return res
    .status(200)
    .json(
        new ApiResponse(200,{},"Password Changed Successfully")
    )

})
const getCurrentUser=asyncHandler(async(req,res)=>{
    return res
    .status(200)
    .json(200,req.user,"current user fetched successully")
})
const updateAccountDetails=asyncHandler(async(req,res)=>{
    const {newFullname,newEmail}=req.body
    if(!fullname||!email){
        throw new ApiError(400,"All files are required")
    }const user=User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                fullname:newFullname,
                email:newEmail
            }
        },{
            new:true
        }
    ).select("-password")
    return res.status(200)
    .json(new ApiResponse(200,user,"Account details updated successfully"))
})
const updateUserAvatar=asyncHandler(async (req,res)=>{
    const avatarLocalPath= req.file?.path
    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar file not found")
    }const avatar=await uploadCloudinary(avatarLocalPath)
    const old_user=await User.findById(req.user?._id)
    const old_url=old_user.avatar;
    if(old_url){deleteCloudinary(old_url)}
    if(!avatar.url){
        throw new ApiError(400,"Error while uploading avatar")
    }const user=await User.findByIdAndUpdate(
        req.user?._id,{
            $set:{
                avatar:avatar.url
            }
        },{new:true}
    ).select("-password")
    return res.status(200)
    .json(new ApiResponse(200,user,"Avatar updated successfully"))
})
const updateUserCover=asyncHandler(async (req,res)=>{
    const coverImagePath=req.file?.path
    // console.log(req.file.path)
    if(!coverImagePath){
        throw new ApiError(404,"Cover Image Not Found")
    }const cover=await uploadCloudinary(coverImagePath)
    const old_user=await User.findById(req.user?._id)
    const old_url=old_user.coverImage;
    if(old_url){deleteCloudinary(old_url)}
    if(!cover.url){
        throw new ApiError(400,"Error while uploading avatar")
    }const user=await User.findByIdAndUpdate(
        req.user?._id,
        {$set:{
            coverImage:cover.url
        }},
        {new:true}
    ).select("-password")
    return res.status(200)
    .json(new ApiResponse(200,user,"Cover Image updated successfully"))
})

export  {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCover
}