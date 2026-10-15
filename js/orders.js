// কাস্টমারের অর্ডার সংক্রান্ত কোড (auth.js ও supabase-client.js আগে লোড হতে হবে)

function isValidDriveLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "drive.google.com" || url.hostname === "docs.google.com");
  } catch (e) {
    return false;
  }
}

async function handleNewOrder(event, session) {
  event.preventDefault();
  const title = document.getElementById("title").value.trim();
  const instructions = document.getElementById("instructions").value.trim();
  const driveLink = document.getElementById("drive-link").value.trim();

  if (title.length < 3) return showMessage("অর্ডারের শিরোনাম লিখুন (কমপক্ষে ৩ অক্ষর)।", "error");
  if (instructions.length < 10) return showMessage("টাইপিংয়ের নির্দেশনা একটু বিস্তারিত লিখুন।", "error");
  if (driveLink && !isValidDriveLink(driveLink)) {
    return showMessage("Google Drive লিংকটি সঠিক নয়। drive.google.com বা docs.google.com থেকে লিংক দিন।", "error");
  }

  const order = {
    customer_id: session.user.id,
    title: title,
    instructions: instructions,
    status: "pending"
  };
  if (driveLink) {
    order.source_type = "drive_link";
    order.source_drive_link = driveLink;
  }

  setLoading(true, "জমা হচ্ছে...");
  const { data, error } = await sb.from("orders").insert(order).select("id").single();
  setLoading(false, "অর্ডার জমা দিন");

  if (error) {
    console.error(error);
    return showMessage("অর্ডার জমা হয়নি। আবার চেষ্টা করুন। (" + error.message + ")", "error");
  }

  document.getElementById("order-form").reset();
  showMessage("অর্ডার জমা হয়েছে। অর্ডার নম্বর: " + data.id.slice(0, 8).toUpperCase(), "success");
}
