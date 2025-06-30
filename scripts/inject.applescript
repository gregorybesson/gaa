on run {feedback}
	tell application "Cursor" to activate
	delay 1
	tell application "System Events"
		keystroke feedback
		key code 36 -- Return key
	end tell
end run