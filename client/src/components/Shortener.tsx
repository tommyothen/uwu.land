import Toastify from "toastify-js";
import { useState } from "preact/hooks";
import "toastify-js/src/toastify.css";

// Define SVGs
const arrowClockwise = (
  <>
    <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
  </>
);
const cursor = (
  <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103zM2.25 8.184l3.897 1.67a.5.5 0 0 1 .262.263l1.67 3.897L12.743 3.52 2.25 8.184z" />
);
const cursorFill = (
  <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
);
const fileEarmark = (
  <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z" />
);
const fileEarmarkFill = (
  <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3z" />
);

export default function Shortener() {
  const [inUse, setInUse] = useState(false);
  const [recieved, setRecieved] = useState(false);
  const [hover, setHover] = useState(false);

  // On submit from a form
  const onSubmit = async (e: any) => {
    e.preventDefault();

    // If the form is already in use, don't do anything
    if (inUse) return;

    // If we have recieved a response, this button will copy the link to the clipboard
    if (recieved) {
      // Copy to clipboard
      const url = e.target.url.value;
      navigator.clipboard.writeText(url);

      // Show toast
      Toastify({
        text: "Copied to clipboard!",
        duration: 3000,
        close: true,
        gravity: "top",
        position: "right",
        backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)",
        stopOnFocus: true,
      }).showToast();

      // Empty the form
      e.target.url.value = "";

      // Set unrecieved and return
      setRecieved(false);
      return;
    }
    // If we haven't recieved a response, this button will send the request
    else {
      // Set the form to in use
      setInUse(true);

      // Get the url from the form
      const url = e.target.url.value;

      // Send the request
      const res = await fetch("https://uwu.land", {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      // If the request was successful, set the recieved state to true
      if (res.status === 201) {
        setRecieved(true);

        const { id, url } = await res.json();

        // Show the link to the user by changing the form value
        e.target.url.value = url;
      } else {
        console.error(res.status);

        Toastify({
          text: "An error occured while shortening the URL",
          duration: 5000,
          close: true,
          gravity: "top",
          position: "right",
          style: {
            // Error background dark
            background: "linear-gradient(to right, #C93838, #A90000)",

            // Rounded corners
            borderRadius: "10px",
          },
        }).showToast();
      }

      // Set the form to not in use
      setInUse(false);
    }
  };

  const getButtonIconName = () => {
    return inUse
      ? "arrow-clockwise"
      : (recieved ? "file-earmark" : "cursor") + (hover ? "-fill" : "");
  };

  const getButtonIconPath = () => {
    let name = getButtonIconName();

    switch (name) {
      case "arrow-clockwise":
        return arrowClockwise;
      case "file-earmark":
        return fileEarmark;
      case "cursor":
        return cursor;
      case "file-earmark-fill":
        return fileEarmarkFill;
      case "cursor-fill":
        return cursorFill;
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <div class="relative">
        <input
          type="url"
          id="url"
          class="block p-3 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-slate-300 outline-none focus:ring"
          placeholder="https://verylongsite.com"
          required=""
        />
        <button
          type="submit"
          class="group absolute right-0 bottom-0 h-full w-12 p-2 bg-slate-300 dark:bg-slate-500 rounded-r-lg flex items-center justify-center"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <svg
            aria-hidden="true"
            class="transition ease-in-out w-5 h-5 dark:fill-slate-800 fill-gray-800 motion-safe:group-hover:scale-[1.05]"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            {getButtonIconPath()}
          </svg>
        </button>
      </div>
    </form>
  );
}
