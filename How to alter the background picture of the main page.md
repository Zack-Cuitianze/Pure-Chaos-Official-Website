### What should you prepare beforehand
##### 1. A picture in the form of .svg or .jpg
All the .svg format images are built with vectors while all the .jpg images are raster images. 
	Use a .svg file to get better quality when you could. 
	Use a .jpg file to better enhance the flexibility and convenience of co-working. 
###### If your original file does not belong to these two kinds of photos, use a converter to transform. 

---
##### 2. Rename the image to: "main page background"
Rename your picture to "main page background". You can double check the format of the image meanwhile. 

---
---
### Elaborate processes
##### Move the file to the particular folder
Check the project folder, in "assets" folder, replace the current background image with your own one. However, you may have to deal with a project folder which lacks the initialized photo. If so, simply add your photograph and things will be all set. 

---
---
### For the best performance (large photographs)
A modern camera picture can be far bigger than a screen needs — the current
one is about 10,000 pixels wide. Painting that directly makes the page stutter
when it opens, so the site also looks for a smaller "display copy" next to the
original picture:

	assets/main page background display.jpg      (2560 pixels wide, a few hundred KB)

If that file exists, it is used instead of the original. You can generate it
on a Mac with one command (Terminal, in the project folder):

	sips --resampleWidth 2560 -s format jpeg -s formatOptions 82 \
	  "assets/main page background.jpg" \
	  --out "assets/main page background display.jpg"

You only need to do this **after replacing the picture**. On the very first
visit it may take a second for the display copy to appear, but after that the
page opens smoothly.

If you skip this step, two things can happen: without a display copy the page
falls back to the original picture and may open with a short stutter; with an
old display copy still present, the page may keep showing the previous
picture. Regenerate (or delete) the display copy whenever the picture changes.
