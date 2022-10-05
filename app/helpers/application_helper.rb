module ApplicationHelper
<<<<<<< HEAD
  def avatar_url(user)
    gravatar_id = Digest::MD5::hexdigest(user.email).downcase
    if user.image
      user.image
    else
      "https://www.gravatar.com/avatar/#{gravatar_id}.jpg?s=150"
    end
  end
end
=======
	def avatar_url(user)
		gravatar_id = Digest::MD5::hexdigest(user.email).downcase
		if user.image
			user.image
		else
		"https://gravatar.com/avatar/#{gravatar_id}.jpg?d=identical&s=150"
		end
	end
end
>>>>>>> 4f53462e1b82b8b17a77f6b4e8a01439d3721d53
